import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getOSToken, getOscpu } from '../NewProfileForm';

/**
 * Original implementations for comparison (before the fix).
 * These represent the behavior that should be PRESERVED for non-buggy inputs.
 */
function getOSToken_original(os: string, version: string): string {
  switch (os) {
    case 'windows': {
      if (version === 'Windows 11') return 'Windows NT 10.0; Win64; x64';
      if (version === 'Windows 10') return 'Windows NT 10.0; Win64; x64';
      if (version === 'Windows 8') return 'Windows NT 6.3; Win64; x64';
      if (version === 'Windows 7') return 'Windows NT 6.1; Win64; x64';
      return 'Windows NT 10.0; Win64; x64';
    }
    case 'macos': {
      // Original code for macOS 10 (legacy) - this is the PRESERVED behavior
      return 'Macintosh; Intel Mac OS X 10_15_7';
    }
    case 'linux':
      return 'X11; Linux x86_64';
    case 'android': {
      const ver = version.match(/\d+/)?.[0] ?? '14';
      return `Linux; Android ${ver}; Pixel 8`;
    }
    case 'ios': {
      const ver = version.match(/\d+/)?.[0] ?? '17';
      return `iPhone; CPU iPhone OS ${ver}_0 like Mac OS X`;
    }
    default:
      return '';
  }
}

function getOscpu_original(os: string, browser: string): string {
  if (browser !== 'firefox') return '';
  if (os === 'windows') return 'Windows NT 10.0; Win64; x64';
  if (os === 'macos') return 'Intel Mac OS X 10.15';
  return 'Linux x86_64';
}

describe('[PBT-preservation] getOSToken preservation for non-macOS-11+ inputs', () => {
  /**
   * Property: For Windows inputs, getOSToken produces same output as original.
   * **Validates: Requirements 3.2**
   */
  it('Windows: getOSToken output unchanged after fix', () => {
    const windowsVersions = fc.constantFrom('All Windows', 'Windows 11', 'Windows 10', 'Windows 8', 'Windows 7');

    fc.assert(
      fc.property(windowsVersions, (version) => {
        const result = getOSToken('windows', version);
        const expected = getOSToken_original('windows', version);
        expect(result).toBe(expected);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: For Linux inputs, getOSToken produces same output as original.
   * **Validates: Requirements 3.3**
   */
  it('Linux: getOSToken output unchanged after fix', () => {
    const linuxVersions = fc.constantFrom('All Linux', 'Ubuntu 24', 'Ubuntu 22', 'Ubuntu 20', 'Debian 12', 'Debian 11', 'Fedora 40', 'Fedora 39');

    fc.assert(
      fc.property(linuxVersions, (version) => {
        const result = getOSToken('linux', version);
        const expected = getOSToken_original('linux', version);
        expect(result).toBe(expected);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: For Android inputs, getOSToken produces same output as original.
   * **Validates: Requirements 3.4**
   */
  it('Android: getOSToken output unchanged after fix', () => {
    const androidVersions = fc.constantFrom('All Android', 'Android 15', 'Android 14', 'Android 13', 'Android 12', 'Android 11', 'Android 10', 'Android 9');

    fc.assert(
      fc.property(androidVersions, (version) => {
        const result = getOSToken('android', version);
        const expected = getOSToken_original('android', version);
        expect(result).toBe(expected);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: For iOS inputs, getOSToken produces same output as original.
   * **Validates: Requirements 3.5**
   */
  it('iOS: getOSToken output unchanged after fix', () => {
    const iosVersions = fc.constantFrom('All iOS', 'iOS 26', 'iOS 18', 'iOS 17', 'iOS 16', 'iOS 15', 'iOS 14', 'iOS 13');

    fc.assert(
      fc.property(iosVersions, (version) => {
        const result = getOSToken('ios', version);
        const expected = getOSToken_original('ios', version);
        expect(result).toBe(expected);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: For macOS 10 (legacy), getOSToken produces same output as original.
   * **Validates: Requirements 3.1**
   */
  it('macOS 10 (legacy): getOSToken output unchanged after fix', () => {
    const result = getOSToken('macos', 'macOS 10');
    const expected = getOSToken_original('macos', 'macOS 10');
    expect(result).toBe(expected);
    expect(result).toBe('Macintosh; Intel Mac OS X 10_15_7');
  });

  /**
   * Property: For Windows + Firefox, oscpu unchanged after fix.
   * **Validates: Requirements 3.6**
   */
  it('Windows + Firefox: oscpu unchanged after fix', () => {
    const windowsVersions = fc.constantFrom('All Windows', 'Windows 11', 'Windows 10', 'Windows 8', 'Windows 7');

    fc.assert(
      fc.property(windowsVersions, (version) => {
        const result = getOscpu('windows', version, 'firefox');
        const expected = getOscpu_original('windows', 'firefox');
        expect(result).toBe(expected);
        expect(result).toBe('Windows NT 10.0; Win64; x64');
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: For Linux + Firefox, oscpu unchanged after fix.
   * **Validates: Requirements 3.7**
   */
  it('Linux + Firefox: oscpu unchanged after fix', () => {
    const linuxVersions = fc.constantFrom('All Linux', 'Ubuntu 24', 'Ubuntu 22', 'Debian 12');

    fc.assert(
      fc.property(linuxVersions, (version) => {
        const result = getOscpu('linux', version, 'firefox');
        const expected = getOscpu_original('linux', 'firefox');
        expect(result).toBe(expected);
        expect(result).toBe('Linux x86_64');
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: For macOS 10 + Firefox, oscpu unchanged after fix.
   * **Validates: Requirements 3.1**
   */
  it('macOS 10 + Firefox: oscpu unchanged after fix', () => {
    const result = getOscpu('macos', 'macOS 10', 'firefox');
    const expected = getOscpu_original('macos', 'firefox');
    expect(result).toBe(expected);
    expect(result).toBe('Intel Mac OS X 10.15');
  });
});
