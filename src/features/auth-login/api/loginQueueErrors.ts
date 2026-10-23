export class QueueRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
  readonly queueGeneration: string | null;

  constructor(
    status: number | null,
    code: string | null = null,
    retryAfterSeconds: number | null = null,
    queueGeneration: string | null = null,
  ) {
    super('Login queue request failed');
    this.name = 'QueueRequestError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.queueGeneration = queueGeneration;
  }
}
