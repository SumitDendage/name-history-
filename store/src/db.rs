//! SQLite persistence for generation history.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

/// Bump when the schema changes and add a step to `migrate`.
const SCHEMA_VERSION: i64 = 1;

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct NewGeneration {
    pub id: String,
    pub client_id: String,
    pub mode: String,
    pub model: Option<String>,
    pub brief: Value,
    pub refinements: Value,
    pub like_name: Option<String>,
    pub names: Value,
    pub requested: i64,
    pub returned: i64,
}

#[derive(Debug, Serialize)]
pub struct Generation {
    pub id: String,
    pub created_at: String,
    pub mode: String,
    pub model: Option<String>,
    pub brief: Value,
    pub refinements: Value,
    pub like_name: Option<String>,
    pub names: Value,
    pub requested: i64,
    pub returned: i64,
}

#[derive(Debug, Serialize, Default)]
pub struct Stats {
    pub total: i64,
    pub last_24h: i64,
    pub by_mode: serde_json::Map<String, Value>,
    pub by_type: serde_json::Map<String, Value>,
    pub by_market: serde_json::Map<String, Value>,
    pub by_style: serde_json::Map<String, Value>,
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            if !dir.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(dir);
            }
        }
        Self::from_connection(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Run a closure on the connection from a blocking thread so the async runtime is never stalled.
    pub async fn run<T, F>(&self, f: F) -> Result<T, DbError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> rusqlite::Result<T> + Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn.lock().map_err(|_| DbError::Poisoned)?;
            f(&mut guard).map_err(DbError::Sqlite)
        })
        .await
        .map_err(|_| DbError::Join)?
    }
}

#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
    Poisoned,
    Join,
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbError::Sqlite(e) => write!(f, "sqlite: {e}"),
            DbError::Poisoned => write!(f, "database lock poisoned"),
            DbError::Join => write!(f, "database task failed"),
        }
    }
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS generations (
                id          TEXT PRIMARY KEY,
                client_id   TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                mode        TEXT NOT NULL CHECK (mode IN ('ai', 'demo')),
                model       TEXT,
                brief       TEXT NOT NULL CHECK (json_valid(brief)),
                refinements TEXT NOT NULL CHECK (json_valid(refinements)),
                like_name   TEXT,
                names       TEXT NOT NULL CHECK (json_valid(names)),
                requested   INTEGER NOT NULL,
                returned    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_generations_client_created
                ON generations (client_id, created_at DESC);
            ",
        )?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

/// Insert a generation, then keep only the newest `keep` rows for that client.
pub fn insert(conn: &mut Connection, g: &NewGeneration, keep: i64) -> rusqlite::Result<String> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO generations (id, client_id, mode, model, brief, refinements, like_name, names, requested, returned)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO NOTHING",
        params![
            g.id,
            g.client_id,
            g.mode,
            g.model,
            g.brief.to_string(),
            g.refinements.to_string(),
            g.like_name,
            g.names.to_string(),
            g.requested,
            g.returned,
        ],
    )?;
    tx.execute(
        "DELETE FROM generations
         WHERE client_id = ?1
           AND id NOT IN (
             SELECT id FROM generations WHERE client_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2
           )",
        params![g.client_id, keep],
    )?;
    let created_at: Option<String> = tx
        .query_row(
            "SELECT created_at FROM generations WHERE id = ?1",
            params![g.id],
            |r| r.get(0),
        )
        .optional()?;
    tx.commit()?;
    Ok(created_at.unwrap_or_default())
}

pub fn list_for_client(
    conn: &mut Connection,
    client_id: &str,
    limit: i64,
) -> rusqlite::Result<Vec<Generation>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, mode, model, brief, refinements, like_name, names, requested, returned
         FROM generations WHERE client_id = ?1
         ORDER BY created_at DESC, rowid DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![client_id, limit], |r| {
        let parse = |s: String| serde_json::from_str::<Value>(&s).unwrap_or(Value::Null);
        Ok(Generation {
            id: r.get(0)?,
            created_at: r.get(1)?,
            mode: r.get(2)?,
            model: r.get(3)?,
            brief: parse(r.get(4)?),
            refinements: parse(r.get(5)?),
            like_name: r.get(6)?,
            names: parse(r.get(7)?),
            requested: r.get(8)?,
            returned: r.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn delete_for_client(conn: &mut Connection, client_id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM generations WHERE client_id = ?1",
        params![client_id],
    )
}

pub fn count(conn: &mut Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM generations", [], |r| r.get(0))
}

pub fn stats(conn: &mut Connection) -> rusqlite::Result<Stats> {
    let mut stats = Stats {
        total: count(conn)?,
        last_24h: conn.query_row(
            "SELECT COUNT(*) FROM generations WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')",
            [],
            |r| r.get(0),
        )?,
        ..Default::default()
    };
    let groups: [(&str, &mut serde_json::Map<String, Value>); 4] = [
        ("mode", &mut stats.by_mode),
        ("json_extract(brief, '$.type')", &mut stats.by_type),
        ("json_extract(brief, '$.market')", &mut stats.by_market),
        ("json_extract(brief, '$.style')", &mut stats.by_style),
    ];
    for (expr, map) in groups {
        // `expr` is one of the fixed expressions above, never user input.
        let sql = format!("SELECT COALESCE({expr}, 'unknown') AS k, COUNT(*) FROM generations GROUP BY k ORDER BY 2 DESC");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (k, n) = row?;
            map.insert(k, Value::from(n));
        }
    }
    Ok(stats)
}
