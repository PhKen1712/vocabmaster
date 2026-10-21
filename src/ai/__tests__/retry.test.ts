import { abortableSleep, jitteredDelay, retryAsync } from '../retry';
import { AiError } from '../types';

describe('jitteredDelay', () => {
  it('grows exponentially and stays inside the 50–100% jitter band', () => {
    const half = () => 0.5; // factor 0.75
    expect(jitteredDelay(1, { baseDelayMs: 1000, maxDelayMs: 10_000, random: half })).toBe(750);
    expect(jitteredDelay(2, { baseDelayMs: 1000, maxDelayMs: 10_000, random: half })).toBe(1500);
    expect(jitteredDelay(3, { baseDelayMs: 1000, maxDelayMs: 10_000, random: half })).toBe(3000);
  });

  it('never waits less than half the exponential step', () => {
    expect(jitteredDelay(1, { baseDelayMs: 1000, random: () => 0 })).toBe(500);
  });

  it('caps at maxDelayMs', () => {
    expect(jitteredDelay(10, { baseDelayMs: 1000, maxDelayMs: 5000, random: () => 1 })).toBe(5000);
  });
});

describe('retryAsync', () => {
  const retryable = (error: unknown) => error instanceof AiError && error.retryable;

  it('retries a transient failure and returns the successful result', async () => {
    const sleep = jest.fn(async () => undefined);
    const task = jest.fn(async (attempt: number) => {
      if (attempt < 3) throw new AiError('server', '503');
      return 'ok';
    });

    const result = await retryAsync(task, {
      attempts: 3,
      sleep,
      random: () => 0.5,
      shouldRetry: retryable,
    });

    expect(result).toBe('ok');
    expect(task).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('stops immediately for errors that cannot recover (bad key)', async () => {
    const sleep = jest.fn(async () => undefined);
    const task = jest.fn(async () => {
      throw new AiError('invalid_key', 'API key not valid');
    });

    await expect(
      retryAsync(task, { attempts: 3, sleep, shouldRetry: retryable }),
    ).rejects.toMatchObject({ code: 'invalid_key' });
    expect(task).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honours a server-supplied Retry-After instead of the backoff curve', async () => {
    const sleep = jest.fn(async () => undefined);
    const task = jest.fn(async (attempt: number) => {
      if (attempt === 1) {
        throw new AiError('rate_limited', 'slow down', { retryAfterMs: 4200 });
      }
      return 'ok';
    });

    await retryAsync(task, { attempts: 2, sleep, baseDelayMs: 100, shouldRetry: retryable });

    expect(sleep).toHaveBeenCalledWith(4200, undefined);
  });

  it('caps a huge Retry-After so the app never waits minutes silently', async () => {
    const sleep = jest.fn(async () => undefined);
    const task = jest.fn(async (attempt: number) => {
      if (attempt === 1) {
        throw new AiError('rate_limited', 'slow down', { retryAfterMs: 600_000 });
      }
      return 'ok';
    });

    await retryAsync(task, {
      attempts: 2,
      sleep,
      maxRetryAfterMs: 20_000,
      shouldRetry: retryable,
    });

    expect(sleep).toHaveBeenCalledWith(20_000, undefined);
  });

  it('throws the last error once attempts are exhausted', async () => {
    const sleep = jest.fn(async () => undefined);
    const task = jest.fn(async () => {
      throw new AiError('network', 'offline');
    });

    await expect(
      retryAsync(task, { attempts: 2, sleep, shouldRetry: retryable }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('refuses to start when the caller already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = jest.fn(async () => 'never');

    await expect(
      retryAsync(task, { signal: controller.signal, shouldRetry: retryable }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(task).not.toHaveBeenCalled();
  });
});

describe('abortableSleep', () => {
  it('rejects as soon as the caller aborts instead of finishing the wait', async () => {
    const controller = new AbortController();
    const pending = abortableSleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('resolves after a short delay', async () => {
    await expect(abortableSleep(5)).resolves.toBeUndefined();
  });
});
