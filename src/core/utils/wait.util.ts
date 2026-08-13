export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Number of retries *after* the first attempt. `retries: 1` means 2 total attempts. */
  retries?: number;
  delayMs?: number;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, delayMs = 1_000 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function poll(
  condition: () => Promise<boolean>,
  options: PollOptions = {},
): Promise<void> {
  const { timeoutMs = 10_000, intervalMs = 500 } = options;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Polling timed out after ${timeoutMs}ms`);
}
