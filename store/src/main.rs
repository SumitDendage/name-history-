//! NameForge store: keeps a short, per-browser history of naming briefs in SQLite.
//!
//! Only the NameForge API server talks to this service (bind it to localhost and set
//! `STORE_TOKEN`). Browsers never reach it directly.

mod db;

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::extract::{DefaultBodyLimit, Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use db::{Db, NewGeneration};

#[derive(Clone)]
pub struct AppState {
    db: Db,
    token: Option<String>,
    keep_per_client: i64,
}

pub struct Config {
    addr: SocketAddr,
    db_path: PathBuf,
    token: Option<String>,
    keep_per_client: i64,
}

impl Config {
    fn from_env() -> Self {
        let addr = std::env::var("STORE_ADDR")
            .ok()
            .and_then(|a| a.parse().ok())
            .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 8790)));
        let db_path = std::env::var("STORE_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/nameforge.db"));
        let token = std::env::var("STORE_TOKEN")
            .ok()
            .map(|t| t.trim().to_owned())
            .filter(|t| !t.is_empty());
        let keep_per_client = std::env::var("STORE_KEEP_PER_CLIENT")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(50)
            .clamp(1, 1000);
        Self {
            addr,
            db_path,
            token,
            keep_per_client,
        }
    }
}

// ---------- Errors ----------

pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_request",
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "error": { "code": self.code, "message": self.message } })),
        )
            .into_response()
    }
}

impl From<db::DbError> for ApiError {
    fn from(err: db::DbError) -> Self {
        tracing::error!(error = %err, "database error");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "store_error",
            message: "The store could not complete the request.".into(),
        }
    }
}

// ---------- Validation ----------

fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameEntry {
    name: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateGeneration {
    id: String,
    client_id: String,
    mode: String,
    model: Option<String>,
    brief: Value,
    #[serde(default)]
    refinements: Vec<String>,
    like_name: Option<String>,
    names: Vec<NameEntry>,
    requested: i64,
    returned: i64,
}

impl CreateGeneration {
    fn validate(self) -> Result<NewGeneration, ApiError> {
        if !is_uuid(&self.id) {
            return Err(ApiError::bad_request("id must be a UUID."));
        }
        if !is_uuid(&self.client_id) {
            return Err(ApiError::bad_request("client_id must be a UUID."));
        }
        if self.mode != "ai" && self.mode != "demo" {
            return Err(ApiError::bad_request("mode must be \"ai\" or \"demo\"."));
        }
        if self.model.as_deref().is_some_and(|m| m.len() > 80) {
            return Err(ApiError::bad_request("model is too long."));
        }
        if !self.brief.is_object() || self.brief.to_string().len() > 8 * 1024 {
            return Err(ApiError::bad_request(
                "brief must be a JSON object under 8 KB.",
            ));
        }
        if self.refinements.len() > 8 || self.refinements.iter().any(|r| r.len() > 32) {
            return Err(ApiError::bad_request("refinements are invalid."));
        }
        if self
            .like_name
            .as_deref()
            .is_some_and(|n| n.chars().count() > 64)
        {
            return Err(ApiError::bad_request("like_name is too long."));
        }
        if self.names.len() > 50 {
            return Err(ApiError::bad_request("At most 50 names per generation."));
        }
        if self.names.iter().any(|n| {
            n.name.trim().is_empty()
                || n.name.chars().count() > 64
                || n.reason.chars().count() > 400
        }) {
            return Err(ApiError::bad_request(
                "Each name needs 1-64 characters and a reason under 400 characters.",
            ));
        }
        if !(0..=100).contains(&self.requested) || !(0..=100).contains(&self.returned) {
            return Err(ApiError::bad_request(
                "requested/returned are out of range.",
            ));
        }
        let names: Vec<Value> = self
            .names
            .into_iter()
            .map(|n| json!({ "name": n.name, "reason": n.reason }))
            .collect();
        Ok(NewGeneration {
            id: self.id.to_lowercase(),
            client_id: self.client_id.to_lowercase(),
            mode: self.mode,
            model: self.model,
            brief: self.brief,
            refinements: json!(self.refinements),
            like_name: self.like_name,
            names: Value::Array(names),
            requested: self.requested,
            returned: self.returned,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct ClientQuery {
    client_id: String,
    limit: Option<i64>,
}

fn client_id(q: &ClientQuery) -> Result<String, ApiError> {
    if is_uuid(&q.client_id) {
        Ok(q.client_id.to_lowercase())
    } else {
        Err(ApiError::bad_request("client_id must be a UUID."))
    }
}

// ---------- Auth ----------

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn require_token(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if let Some(expected) = &state.token {
        let provided = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
            return ApiError {
                status: StatusCode::UNAUTHORIZED,
                code: "unauthorized",
                message: "Missing or invalid store token.".into(),
            }
            .into_response();
        }
    }
    next.run(req).await
}

// ---------- Handlers ----------

async fn health(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let total = state.db.run(db::count).await?;
    Ok(Json(json!({ "status": "ok", "generations": total })))
}

async fn create_generation(
    State(state): State<AppState>,
    Json(body): Json<CreateGeneration>,
) -> Result<impl IntoResponse, ApiError> {
    let generation = body.validate()?;
    let keep = state.keep_per_client;
    let id = generation.id.clone();
    let created_at = state
        .db
        .run(move |conn| db::insert(conn, &generation, keep))
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": id, "created_at": created_at })),
    ))
}

async fn list_generations(
    State(state): State<AppState>,
    Query(q): Query<ClientQuery>,
) -> Result<Json<Value>, ApiError> {
    let client = client_id(&q)?;
    let limit = q.limit.unwrap_or(10).clamp(1, 50);
    let entries = state
        .db
        .run(move |conn| db::list_for_client(conn, &client, limit))
        .await?;
    Ok(Json(json!({ "entries": entries })))
}

async fn delete_generations(
    State(state): State<AppState>,
    Query(q): Query<ClientQuery>,
) -> Result<Json<Value>, ApiError> {
    let client = client_id(&q)?;
    let deleted = state
        .db
        .run(move |conn| db::delete_for_client(conn, &client))
        .await?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn stats(State(state): State<AppState>) -> Result<Json<db::Stats>, ApiError> {
    Ok(Json(state.db.run(db::stats).await?))
}

async fn not_found() -> ApiError {
    ApiError {
        status: StatusCode::NOT_FOUND,
        code: "not_found",
        message: "No such route.".into(),
    }
}

pub fn router(state: AppState) -> Router {
    let v1 = Router::new()
        .route(
            "/generations",
            get(list_generations)
                .post(create_generation)
                .delete(delete_generations),
        )
        .route("/stats", get(stats))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    Router::new()
        .route("/health", get(health))
        .nest("/v1", v1)
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(32 * 1024))
        .with_state(state)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}

#[tokio::main]
async fn main() {
    // Finds store/.env or the shared repo-root .env by walking up from the working directory.
    // Real environment variables win.
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nameforge_store=info".into()),
        )
        .init();

    let config = Config::from_env();
    let db = match Db::open(&config.db_path) {
        Ok(db) => db,
        Err(err) => {
            tracing::error!(error = %err, path = %config.db_path.display(), "could not open database");
            std::process::exit(1);
        }
    };
    if config.token.is_none() {
        tracing::warn!("STORE_TOKEN is not set: /v1 routes are unauthenticated. Keep the store bound to localhost.");
    }

    let state = AppState {
        db,
        token: config.token,
        keep_per_client: config.keep_per_client,
    };
    let listener = match tokio::net::TcpListener::bind(config.addr).await {
        Ok(l) => l,
        Err(err) => {
            tracing::error!(error = %err, addr = %config.addr, "could not bind");
            std::process::exit(1);
        }
    };
    tracing::info!(addr = %config.addr, db = %config.db_path.display(), "NameForge store listening");
    if let Err(err) = axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(error = %err, "server error");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    const CLIENT: &str = "3f1c2a5e-8b7d-4c1e-9a2b-1234567890ab";
    const OTHER: &str = "9a8b7c6d-1111-4222-8333-444455556666";

    fn app(token: Option<&str>, keep: i64) -> Router {
        router(AppState {
            db: Db::in_memory().unwrap(),
            token: token.map(str::to_owned),
            keep_per_client: keep,
        })
    }

    fn generation(id: &str, client: &str) -> Value {
        json!({
            "id": id,
            "client_id": client,
            "mode": "demo",
            "model": null,
            "brief": { "type": "business", "market": "both", "style": "minimal", "keywords": ["glow"] },
            "refinements": ["shorter"],
            "like_name": null,
            "names": [{ "name": "Lumora", "reason": "Soft and bright." }],
            "requested": 12,
            "returned": 1
        })
    }

    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }

    async fn send(
        app: &Router,
        method: &str,
        uri: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut req = HttpRequest::builder().method(method).uri(uri);
        if let Some(t) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let req = match body {
            Some(b) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string()))
                .unwrap(),
            None => req.body(Body::empty()).unwrap(),
        };
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[tokio::test]
    async fn health_is_open() {
        let app = app(Some("secret"), 50);
        let (status, body) = send(&app, "GET", "/health", None, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
    }

    #[tokio::test]
    async fn v1_requires_token_when_configured() {
        let app = app(Some("secret"), 50);
        let uri = format!("/v1/generations?client_id={CLIENT}");
        assert_eq!(
            send(&app, "GET", &uri, None, None).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(&app, "GET", &uri, None, Some("wrong")).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(&app, "GET", &uri, None, Some("secret")).await.0,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn records_and_lists_per_client_newest_first() {
        let app = app(None, 50);
        for n in 1..=3 {
            let (status, _) = send(
                &app,
                "POST",
                "/v1/generations",
                Some(generation(&id(n), CLIENT)),
                None,
            )
            .await;
            assert_eq!(status, StatusCode::CREATED);
        }
        send(
            &app,
            "POST",
            "/v1/generations",
            Some(generation(&id(9), OTHER)),
            None,
        )
        .await;

        let (status, body) = send(
            &app,
            "GET",
            &format!("/v1/generations?client_id={CLIENT}&limit=2"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let entries = body["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["id"], id(3));
        assert_eq!(entries[0]["brief"]["market"], "both");
        assert_eq!(entries[0]["names"][0]["name"], "Lumora");
    }

    #[tokio::test]
    async fn prunes_old_rows_per_client() {
        let app = app(None, 2);
        for n in 1..=5 {
            send(
                &app,
                "POST",
                "/v1/generations",
                Some(generation(&id(n), CLIENT)),
                None,
            )
            .await;
        }
        let (_, body) = send(
            &app,
            "GET",
            &format!("/v1/generations?client_id={CLIENT}&limit=50"),
            None,
            None,
        )
        .await;
        let ids: Vec<_> = body["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(ids, vec![id(5), id(4)]);
    }

    #[tokio::test]
    async fn rejects_invalid_input() {
        let app = app(None, 50);
        let mut bad = generation(&id(1), "not-a-uuid");
        assert_eq!(
            send(&app, "POST", "/v1/generations", Some(bad.clone()), None)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        bad["client_id"] = json!(CLIENT);
        bad["mode"] = json!("magic");
        assert_eq!(
            send(&app, "POST", "/v1/generations", Some(bad.clone()), None)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        bad["mode"] = json!("ai");
        bad["unexpected"] = json!(true);
        assert_eq!(
            send(&app, "POST", "/v1/generations", Some(bad), None)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            send(&app, "GET", "/v1/generations?client_id=nope", None, None)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn deletes_only_that_clients_history() {
        let app = app(None, 50);
        send(
            &app,
            "POST",
            "/v1/generations",
            Some(generation(&id(1), CLIENT)),
            None,
        )
        .await;
        send(
            &app,
            "POST",
            "/v1/generations",
            Some(generation(&id(2), OTHER)),
            None,
        )
        .await;
        let (status, body) = send(
            &app,
            "DELETE",
            &format!("/v1/generations?client_id={CLIENT}"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["deleted"], 1);
        let (_, other) = send(
            &app,
            "GET",
            &format!("/v1/generations?client_id={OTHER}"),
            None,
            None,
        )
        .await;
        assert_eq!(other["entries"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn reports_stats() {
        let app = app(None, 50);
        send(
            &app,
            "POST",
            "/v1/generations",
            Some(generation(&id(1), CLIENT)),
            None,
        )
        .await;
        send(
            &app,
            "POST",
            "/v1/generations",
            Some(generation(&id(2), OTHER)),
            None,
        )
        .await;
        let (_, body) = send(&app, "GET", "/v1/stats", None, None).await;
        assert_eq!(body["total"], 2);
        assert_eq!(body["by_market"]["both"], 2);
        assert_eq!(body["by_mode"]["demo"], 2);
    }

    #[test]
    fn uuid_check() {
        assert!(is_uuid(CLIENT));
        assert!(!is_uuid("3f1c2a5e8b7d4c1e9a2b1234567890ab"));
        assert!(!is_uuid("3f1c2a5e-8b7d-4c1e-9a2b-1234567890ag"));
    }
}
