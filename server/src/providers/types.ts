import type { Candidate } from '../rules';
import type { GenerationInput } from '../prompt';

export interface NameGenerator {
  readonly mode: 'ai' | 'demo';
  readonly model: string | null;
  generate(input: GenerationInput, signal: AbortSignal): Promise<Candidate[]>;
}

/** An error with a safe, user-facing message and an HTTP status. */
export class GenerationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}
