import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Original buggy implementation of getOSToken for macOS.
 * This always produced format `10_${ver}_7` regardless of version.
 */
function getOSToken_original_macos(version: string): string {
  const ver = version.match(/\d+/)?.[0] ?? '15';
  return `Macintosh; Intel Mac OS X 10_${ver}_7`;
}

describe('[PBT-exploration] getOSToken original bug detection', () => {
  /**
   * **Validates: Requirements 2.1**
   *
   * This exploration test demonstrates that the ORIGINAL (unfixed) getOSToken()
   * logic would produce wrong format for macOS 11+. The original code always
   * used `10_${ver}_7` format, which is incorrect for macOS 11+.
   *
   * For any macOS version >= 11, the original code produces output containing
   * `10_` prefix (e.g., `10_26_7` for macOS 26), which does NOT match the
   * correct format `{major}_1_0`.
   */
  it('original code produces wrong format for macOS 11+ (contains 10_ prefix)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 11, max: 30 }),
        (majorVersion) => {
          const versionString = `macOS ${majorVersion}`;
          const result = getOSToken_original_macos(versionString);

          // The original code INCORRECTLY produces format with 10_ prefix
          // e.g., "Macintosh; Intel Mac OS X 10_26_7" for macOS 26
          expect(result).toContain('10_');
          expect(result).toBe(`Macintosh; Intel Mac OS X 10_${majorVersion}_7`);

          // This proves the bug: the output does NOT match the correct format
          expect(result).not.toBe(`Macintosh; Intel Mac OS X ${majorVersion}_1_0`);
        }
      ),
      { numRuns: 100 }
    );
  });
});
