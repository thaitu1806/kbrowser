import { describe, it, expect } from 'vitest';
import { ConcurrencyController } from '../concurrency-controller';

describe('ConcurrencyController', () => {
  it('should initialize with 0 running count', () => {
    const cc = new ConcurrencyController(3);
    expect(cc.getRunningCount()).toBe(0);
    expect(cc.getMaxConcurrency()).toBe(3);
    expect(cc.isFull()).toBe(false);
  });

  it('should acquire slots up to max concurrency', () => {
    const cc = new ConcurrencyController(2);

    expect(cc.acquire()).toBe(true);
    expect(cc.getRunningCount()).toBe(1);

    expect(cc.acquire()).toBe(true);
    expect(cc.getRunningCount()).toBe(2);

    // At capacity
    expect(cc.acquire()).toBe(false);
    expect(cc.getRunningCount()).toBe(2);
  });

  it('should release slots and allow re-acquisition', () => {
    const cc = new ConcurrencyController(1);

    expect(cc.acquire()).toBe(true);
    expect(cc.acquire()).toBe(false);

    cc.release();
    expect(cc.getRunningCount()).toBe(0);

    expect(cc.acquire()).toBe(true);
    expect(cc.getRunningCount()).toBe(1);
  });

  it('should never let running count go below 0 on release', () => {
    const cc = new ConcurrencyController(3);

    cc.release();
    cc.release();
    expect(cc.getRunningCount()).toBe(0);
  });

  it('should report isFull correctly', () => {
    const cc = new ConcurrencyController(2);

    expect(cc.isFull()).toBe(false);
    cc.acquire();
    expect(cc.isFull()).toBe(false);
    cc.acquire();
    expect(cc.isFull()).toBe(true);
    cc.release();
    expect(cc.isFull()).toBe(false);
  });

  it('should allow dynamic update of max concurrency', () => {
    const cc = new ConcurrencyController(2);

    cc.acquire();
    cc.acquire();
    expect(cc.isFull()).toBe(true);

    cc.setMaxConcurrency(3);
    expect(cc.getMaxConcurrency()).toBe(3);
    expect(cc.isFull()).toBe(false);
    expect(cc.acquire()).toBe(true);
    expect(cc.isFull()).toBe(true);
  });

  it('should handle setMaxConcurrency below current running count', () => {
    const cc = new ConcurrencyController(5);

    cc.acquire();
    cc.acquire();
    cc.acquire();
    expect(cc.getRunningCount()).toBe(3);

    // Reduce max below current running — isFull should be true, no new acquires
    cc.setMaxConcurrency(2);
    expect(cc.isFull()).toBe(true);
    expect(cc.acquire()).toBe(false);

    // Releasing should still work
    cc.release();
    expect(cc.getRunningCount()).toBe(2);
    expect(cc.isFull()).toBe(true);

    cc.release();
    expect(cc.getRunningCount()).toBe(1);
    expect(cc.isFull()).toBe(false);
    expect(cc.acquire()).toBe(true);
  });
});
