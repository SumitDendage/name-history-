import { randomUUID } from 'node:crypto';
import { TARGET_COUNT, type GenerateResponse } from '../../shared/brief';
import type { GenerationInput } from './prompt';
import { GenerationError, type NameGenerator } from './providers/types';
import { deriveRules, enforceRules, isHandleType, summariseRejections } from './rules';
import type { ParsedGenerateRequest } from './schema';

/** Ask for more than we need, then keep only names that pass every rule. */
const OVERGENERATE = 20;
/** Only attempt a top-up round when at least this much time is left before the deadline. */
const TOP_UP_MIN_MS = 15_000;

export interface RunOptions {
  /** Epoch ms by which we must answer (serverless limits). The top-up round is skipped or cut short to meet it. */
  deadlineAt?: number;
}

export async function runGeneration(
  request: ParsedGenerateRequest,
  generator: NameGenerator,
  signal: AbortSignal,
  options: RunOptions = {},
): Promise<GenerateResponse> {
  const { brief, refinements, likeName } = request;
  const handle = isHandleType(brief.type);
  const rules = deriveRules(brief, refinements, request.previous ?? request.exclude);
  const exclude = likeName ? [...request.exclude, likeName] : request.exclude;

  const input: GenerationInput = { brief, refinements, likeName, exclude, rules, count: OVERGENERATE };
  const first = await generator.generate(input, signal);
  const { accepted, rejected } = enforceRules(first, rules, handle, { exclude });

  // One top-up round if the rules filtered out too many. If it fails or runs out of time,
  // we still return what we have (possibly fewer than 12).
  const timeLeft = options.deadlineAt ? options.deadlineAt - Date.now() : Infinity;
  if (accepted.length < TARGET_COUNT && generator.mode === 'ai' && timeLeft > TOP_UP_MIN_MS) {
    const seen = [...exclude, ...accepted.map((c) => c.name), ...rejected.map((r) => r.name)].slice(-200);
    const topUpSignal = Number.isFinite(timeLeft) ? AbortSignal.any([signal, AbortSignal.timeout(timeLeft - 2_000)]) : signal;
    try {
      const more = await generator.generate(
        { ...input, exclude: seen, count: TARGET_COUNT - accepted.length + 6 },
        topUpSignal,
      );
      const second = enforceRules(more, rules, handle, { exclude, alreadyAccepted: accepted });
      accepted.push(...second.accepted);
      rejected.push(...second.rejected);
    } catch (error) {
      if (signal.aborted) throw error;
      if (accepted.length === 0) throw error;
    }
  }

  const final = accepted.slice(0, TARGET_COUNT);
  const notes: string[] = [];
  if (refinements.includes('shorter')) notes.push(`Shorter: every name is now ${rules.maxLength} characters or fewer.`);
  notes.push(...summariseRejections(rejected, rules, final.length));

  return {
    requestId: randomUUID(),
    mode: generator.mode,
    model: generator.model,
    requested: TARGET_COUNT,
    returned: final.length,
    suggestions: final.map((c) => ({
      id: randomUUID(),
      name: c.name,
      reason: c.reason,
      length: c.name.length,
      availability: { username: 'unchecked', domain: 'unchecked' },
    })),
    rules,
    refinements,
    likeName: likeName ?? null,
    notes,
    createdAt: new Date().toISOString(),
  };
}

export function toGenerationError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new GenerationError(499, 'cancelled', 'The request was cancelled.', true);
  }
  return new GenerationError(500, 'internal', 'Something went wrong on our side. Please try again.', true);
}
