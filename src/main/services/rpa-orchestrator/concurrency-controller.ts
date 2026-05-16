/**
 * Concurrency Controller
 *
 * Semaphore-based concurrency control for limiting the number of
 * simultaneously running RPA tasks. Provides acquire/release semantics
 * with dynamic max concurrency adjustment.
 */

export class ConcurrencyController {
  private runningCount: number = 0;
  private maxConcurrency: number;

  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Attempt to acquire a concurrency slot.
   * Returns true if a slot was available and acquired, false if at capacity.
   */
  acquire(): boolean {
    if (this.runningCount >= this.maxConcurrency) {
      return false;
    }
    this.runningCount++;
    return true;
  }

  /**
   * Release a concurrency slot. Running count never goes below 0.
   */
  release(): void {
    if (this.runningCount > 0) {
      this.runningCount--;
    }
  }

  /** Get the current number of running tasks. */
  getRunningCount(): number {
    return this.runningCount;
  }

  /** Get the configured maximum concurrency limit. */
  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /** Dynamically update the maximum concurrency limit. */
  setMaxConcurrency(max: number): void {
    this.maxConcurrency = max;
  }

  /** Returns true when running count has reached the concurrency limit. */
  isFull(): boolean {
    return this.runningCount >= this.maxConcurrency;
  }
}
