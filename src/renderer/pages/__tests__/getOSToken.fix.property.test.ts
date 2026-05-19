import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getOSToken, getOscpu } from '../NewProfileForm';

describe('[PBT-fix] getOSToken fixed code verification', () => {
  /**
   * **Validates: Requirements 2.1**
   *
   * Property: For any macOS version >= 11, the fixed getOSToken() SHALL return
   * format `Macintosh; Intel Mac OS X {major}_1_0`.
   *
   * This verifies Correctness Property 1 from design.md.
   */
  it('fixed code returns correct format {major}_1_0 for macOS 11+', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 11, max: 30 }),
        (majorVersion) => {
          const versionString = `macOS ${majorVersion}`;
          const result = getOSToken('macos', versionString);

          // The fixed code should produce correct format
          expect(result).toBe(`Macintosh; Intel Mac OS X ${majorVersion}_1_0`);

          // Should NOT contain the old buggy 10_ prefix
          expect(result).not.toContain('10_');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * Property: For any macOS version >= 11 with Firefox, the fixed getOscpu() SHALL return
   * format `Intel Mac OS X {major}.1`.
   *
   * This verifies Correctness Property 2 from design.md.
   */
  it('fixed oscpu returns correct format for macOS 11+ with Firefox', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 11, max: 30 }),
        (majorVersion) => {
          const versionString = `macOS ${majorVersion}`;
          const result = getOscpu('macos', versionString, 'firefox');

          // The fixed code should produce correct oscpu format
          expect(result).toBe(`Intel Mac OS X ${majorVersion}.1`);

          // Should NOT be the old hardcoded value
          expect(result).not.toBe('Intel Mac OS X 10.15');
        }
      ),
      { numRuns: 100 }
    );
  });
});
