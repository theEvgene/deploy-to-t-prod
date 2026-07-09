import { UserAbortError, throwIfAborted } from "./abort.js";

export type PollResult<T> =
  | {
      done: true;
      value: T;
    }
  | {
      done: false;
    };

type PollUntilOptions<T> = {
  timeoutMinutes?: number;
  deadlineMs?: number;
  intervalSeconds: number;
  signal: AbortSignal;
  action: () => Promise<PollResult<T>>;
  onTimeout: () => Promise<never> | never;
};

export async function pollUntil<T>({
  timeoutMinutes,
  deadlineMs,
  intervalSeconds,
  signal,
  action,
  onTimeout,
}: PollUntilOptions<T>): Promise<T> {
  const expiresAt = deadlineMs ?? createExpiresAt(timeoutMinutes);

  while (Date.now() < expiresAt) {
    throwIfAborted(signal);
    const result = await action();
    throwIfAborted(signal);

    if (result.done) {
      return result.value;
    }

    await delay(intervalSeconds, signal);
  }

  throwIfAborted(signal);
  return onTimeout();
}

export function createDeadlineMs(timeoutMinutes: number): number {
  return createExpiresAt(timeoutMinutes);
}

export function done<T>(value: T): PollResult<T> {
  return {
    done: true,
    value,
  };
}

export function pending<T = never>(): PollResult<T> {
  return {
    done: false,
  };
}

async function delay(seconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(new UserAbortError());
    };
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, seconds * 1000);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createExpiresAt(timeoutMinutes: number | undefined): number {
  if (timeoutMinutes === undefined) {
    throw new Error("pollUntil requires timeoutMinutes or deadlineMs.");
  }

  return Date.now() + timeoutMinutes * 60 * 1000;
}
