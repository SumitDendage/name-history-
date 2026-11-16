import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Effort } from '../config';
import { buildUserPrompt, SUGGESTIONS_JSON_SCHEMA, SYSTEM_PROMPT, type GenerationInput } from '../prompt';
import type { Candidate } from '../rules';
import { GenerationError, type NameGenerator } from './types';

/** Models that accept the server-side `fallbacks` parameter (re-runs a declined request on another model). */
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const outputSchema = z.object({
  suggestions: z.array(z.object({ name: z.string(), reason: z.string() })),
});

export interface AnthropicGeneratorOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  timeoutMs: number;
  /** Injected in tests. */
  client?: Anthropic;
}

export class AnthropicGenerator implements NameGenerator {
  readonly mode = 'ai' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;
  private readonly timeoutMs: number;

  constructor(options: AnthropicGeneratorOptions) {
    this.model = options.model;
    this.effort = options.effort;
    this.timeoutMs = options.timeoutMs;
    // The key lives only here, on the server. It is never sent to the browser.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 1 });
  }

  async generate(input: GenerationInput, signal: AbortSignal): Promise<Candidate[]> {
    const useFallbacks = FALLBACK_MODELS.has(this.model);
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(input) }],
          output_config: {
            effort: this.effort,
            format: { type: 'json_schema', schema: SUGGESTIONS_JSON_SCHEMA },
          },
          ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal, timeout: this.timeoutMs },
      );
    } catch (error) {
      throw mapAnthropicError(error);
    }

    if (response.stop_reason === 'refusal') {
      throw new GenerationError(
        422,
        'ai_declined',
        "The AI couldn't work with this brief. Try rewording your requirements.",
        false,
      );
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GenerationError(502, 'ai_bad_output', 'The AI sent back an unreadable answer. Please try again.', true);
    }
    const parsed = outputSchema.safeParse(json);
    if (!parsed.success) {
      throw new GenerationError(502, 'ai_bad_output', 'The AI sent back an unexpected answer. Please try again.', true);
    }
    return parsed.data.suggestions;
  }
}

export function mapAnthropicError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error;
  const detail = error instanceof Anthropic.APIError ? `${error.status ?? 'network'}: ${error.message}`.slice(0, 300) : undefined;
  if (error instanceof Anthropic.APIUserAbortError) {
    return new GenerationError(499, 'cancelled', 'The request was cancelled.', true, detail);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new GenerationError(504, 'ai_timeout', 'The AI took too long to answer. Please try again.', true, detail);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new GenerationError(503, 'ai_busy', 'The AI is busy right now. Please try again in a moment.', true, detail);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new GenerationError(502, 'ai_misconfigured', "The server's AI key was rejected. Ask the site owner to check it.", false, detail);
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new GenerationError(502, 'ai_request_failed', 'The AI could not process this request. Please try demo mode.', false, detail);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new GenerationError(503, 'ai_unreachable', "We couldn't reach the AI service. Please try again.", true, detail);
  }
  if (error instanceof Anthropic.APIError) {
    return new GenerationError(503, 'ai_unavailable', 'The AI service had a problem. Please try again.', true, detail);
  }
  return new GenerationError(500, 'internal', 'Something went wrong on our side. Please try again.', true, detail);
}
