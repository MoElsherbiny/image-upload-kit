export class SemaphoreQueueFullError extends Error {
  readonly status = 503;

  constructor(
    message: string = 'Server upload queue is full. Please try again later.',
  ) {
    super(message);
    this.name = 'SemaphoreQueueFullError';
  }
}

export interface SemaphoreOptions {
  maxQueue?: number;
}

export interface SemaphoreRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  label?: string;
}

interface QueueEntry {
  grant: () => void;
  cancel: (reason: unknown) => void;
}

interface ErrorWithPendingTask {
  pendingTask?: Promise<unknown>;
}

function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const err = new Error(
    typeof signal?.reason === 'string' ? signal.reason : 'Operation aborted',
  );
  err.name = 'AbortError';
  return err;
}

export class AsyncSemaphore {
  private activeCount = 0;
  private readonly maxQueue?: number;
  private readonly queue: QueueEntry[] = [];

  constructor(
    private readonly concurrency: number,
    options?: SemaphoreOptions | number,
  ) {
    if (concurrency < 1) {
      throw new Error('AsyncSemaphore concurrency must be >= 1');
    }
    if (typeof options === 'number') {
      this.maxQueue = options;
    } else if (options && typeof options === 'object') {
      this.maxQueue = options.maxQueue;
    }
  }

  get active(): number {
    return this.activeCount;
  }

  get pending(): number {
    return this.queue.length;
  }

  async run<T>(
    task: () => Promise<T>,
    options: SemaphoreRunOptions = {},
  ): Promise<T> {
    const { signal, timeoutMs, label = 'Semaphore task' } = options;
    await this.acquire(signal);

    let rawTaskPromise: Promise<T>;
    try {
      rawTaskPromise = Promise.resolve().then(task);
    } catch (syncError) {
      this.release();
      throw syncError;
    }

    let released = false;
    const releaseOnce = () => {
      if (!released) {
        released = true;
        this.release();
      }
    };

    void rawTaskPromise.then(
      () => releaseOnce(),
      (err: unknown) => {
        const pending =
          err && typeof err === 'object' && 'pendingTask' in err
            ? (err as ErrorWithPendingTask).pendingTask
            : undefined;
        if (pending && typeof pending.then === 'function') {
          void pending.then(releaseOnce, releaseOnce);
        } else {
          releaseOnce();
        }
      },
    );

    let callerPromise = rawTaskPromise;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      callerPromise = withTimeout(callerPromise, timeoutMs, label);
    }
    if (signal) {
      callerPromise = raceWithAbort(callerPromise, signal);
    }

    return callerPromise;
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    if (this.maxQueue !== undefined && this.queue.length >= this.maxQueue) {
      return Promise.reject(new SemaphoreQueueFullError());
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        entry.cancel(createAbortError(signal));
      };

      const entry: QueueEntry = {
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          this.activeCount += 1;
          resolve();
        },
        cancel: (reason: unknown) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.queue.shift();
    next?.grant();
  }
}

function raceWithAbort<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    const err = createAbortError(signal) as Error & ErrorWithPendingTask;
    err.pendingTask = task.then(
      () => {},
      () => {},
    );
    return Promise.reject(err);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const err = createAbortError(signal) as Error & ErrorWithPendingTask;
      err.pendingTask = task.then(
        () => {},
        () => {},
      );
      reject(err);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const settledTask = task.then(
    () => {},
    () => {},
  );

  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const err = new Error(
            `${label} timed out after ${timeoutMs}ms`,
          ) as Error & ErrorWithPendingTask;
          err.pendingTask = settledTask;
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
