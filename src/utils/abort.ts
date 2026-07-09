export class UserAbortError extends Error {
  constructor(message = "Execution stopped by user.") {
    super(message);
    this.name = "UserAbortError";
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new UserAbortError();
  }
}

export function isUserAbortError(error: unknown): boolean {
  return error instanceof UserAbortError;
}

