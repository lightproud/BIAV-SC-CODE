/**
 * BPT Agent SDK - error types.
 */

/** Thrown when an operation is aborted via AbortController/interrupt(). */
export class AbortError extends Error {
  override name = 'AbortError';
  constructor(message = 'The operation was aborted') {
    super(message);
  }
}

/** Network-level failure talking to the Messages API. */
export class APIConnectionError extends Error {
  override name = 'APIConnectionError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Non-2xx response from the Messages API. */
export class APIStatusError extends Error {
  override name = 'APIStatusError';
  constructor(
    readonly status: number,
    readonly errorType: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/** Feature accepted for type compatibility but not implemented in this version. */
export class NotImplementedError extends Error {
  override name = 'NotImplementedError';
  constructor(feature: string, hint?: string) {
    super(
      `bpt-agent-sdk: ${feature} is not implemented in this version${hint ? `. ${hint}` : ''}`,
    );
  }
}

/** Invalid or missing configuration (e.g. no API key resolvable). */
export class ConfigurationError extends Error {
  override name = 'ConfigurationError';
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof AbortError ||
    (err instanceof Error && err.name === 'AbortError')
  );
}
