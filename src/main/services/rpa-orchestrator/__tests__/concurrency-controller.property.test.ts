// Feature: profile-rpa, Property 10: Concurrency limit enforcement

/**
 * Property-based test for Concurrency Controller.
 *
 * Uses fast-check to verify that for any sequence of acquire/release operations,
 * the running count never exceeds maxConcurrency.
 *
 * **Validates: Requirements 3.6**
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { ConcurrencyController } from '../concurrency-controller';

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Operation type: either acquire or release */
type Operation = 'acquire' | 'release';

const arbOperation: fc.Arbitrary<Operation> = fc.constantFrom('acquire', 'release');

/** Generate a sequence of acquire/release operations (1–50 operations) */
const arbOperationSequence: fc.Arbitrary<Operation[]> = fc.array(arbOperation, {
  minLength: 1,
  maxLength: 50,
});

/** Generate a valid maxConcurrency value (1–20) */
const arbMaxConcurrency: fc.Arbitrary<number> = fc.integer({ min: 1, max: 20 });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('ConcurrencyController property tests', () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * Property 10: Concurrency limit enforcement
   *
   * For any maxConcurrency N and any sequence of acquire/release calls,
   * getRunningCount() never exceeds N at any point during execution.
   */
  it('Property 10: For any sequence of acquire/release operations, running count never exceeds maxConcurrency', () => {
    fc.assert(
      fc.property(
        arbMaxConcurrency,
        arbOperationSequence,
        (maxConcurrency, operations) => {
          const controller = new ConcurrencyController(maxConcurrency);

          for (const op of operations) {
            if (op === 'acquire') {
              controller.acquire();
            } else {
              controller.release();
            }

            // After every operation, running count must never exceed maxConcurrency
            const runningCount = controller.getRunningCount();
            if (runningCount > maxConcurrency) {
              return false;
            }

            // Running count must also never be negative
            if (runningCount < 0) {
              return false;
            }
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
