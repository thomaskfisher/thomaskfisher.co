/**
 * Level supply, with the next level generated while the current one is played.
 *
 * Generation is the one genuinely expensive thing these games do — a hard level
 * costs dozens of solver runs — and it lands exactly when the player taps
 * "Next", which is the worst possible moment to drop a frame. So it happens on
 * a worker, one level ahead.
 *
 * Generic over the level type because all three games need the same plumbing;
 * each supplies its own worker and a same-thread fallback for environments
 * where Workers are unavailable.
 */

export interface LevelRequest {
  id: number;
  seed: string;
  level: number;
}

export interface LevelResponse<T> {
  id: number;
  ok: boolean;
  level?: T;
  error?: string;
}

export interface LevelSourceOptions<T> {
  seed: string;
  /** Must use a literal `new URL(...)` so the bundler can find the worker. */
  createWorker: () => Worker;
  /** Same-thread generation, used when a worker is unavailable or fails. */
  generate: (seed: string, level: number) => T;
}

interface Pending<T> {
  resolve: (level: T) => void;
  reject: (error: Error) => void;
}

export class LevelSource<T> {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending<T>>();
  private nextId = 1;
  private prefetched: { level: number; promise: Promise<T> } | null = null;

  constructor(private readonly options: LevelSourceOptions<T>) {
    this.worker = this.spawn();
  }

  private spawn(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = this.options.createWorker();

      worker.addEventListener('message', (event: MessageEvent<LevelResponse<T>>) => {
        const { id, ok, level, error } = event.data;
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        if (ok && level) request.resolve(level);
        else request.reject(new Error(error ?? 'Level generation failed'));
      });

      // A worker that dies mid-session should degrade, not break the game.
      worker.addEventListener('error', () => this.degrade());

      return worker;
    } catch {
      return null;
    }
  }

  private degrade(): void {
    this.worker = null;
    for (const [, request] of this.pending) request.reject(new Error('Worker unavailable'));
    this.pending.clear();
  }

  private request(level: number): Promise<T> {
    const worker = this.worker;
    const onMainThread = (): Promise<T> =>
      Promise.resolve().then(() => this.options.generate(this.options.seed, level));

    if (!worker) return onMainThread();

    const id = this.nextId++;
    const message: LevelRequest = { id, seed: this.options.seed, level };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(message);
    }).catch(onMainThread);
  }

  get(level: number): Promise<T> {
    if (this.prefetched?.level === level) {
      const { promise } = this.prefetched;
      this.prefetched = null;
      return promise;
    }
    return this.request(level);
  }

  /** Called once a level is on screen, so the next is ready before it is wanted. */
  prefetch(level: number): void {
    if (this.prefetched?.level === level) return;
    this.prefetched = { level, promise: this.request(level) };
    // A rejected prefetch must not surface as an unhandled rejection.
    this.prefetched.promise.catch(() => undefined);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
