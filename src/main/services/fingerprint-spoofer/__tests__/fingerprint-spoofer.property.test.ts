/**
 * Property-based tests for Fingerprint Spoofer (P7–P11).
 *
 * Uses fast-check to verify correctness properties defined in the design document.
 * Tests focus on fingerprint uniqueness, hardware value ranges, session consistency,
 * User-Agent consistency, and font list constraints.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { FingerprintSpoofer } from '../fingerprint-spoofer';
import { generateHardwareScript, generateFontListScript } from '../injection-scripts';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';
import type { FingerprintConfig } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** OS-consistent fingerprint config profiles. */
interface OsProfile {
  uaFragment: string;
  platform: string;
  oscpuFragment: string;
}

const osProfiles: OsProfile[] = [
  {
    uaFragment: 'Windows NT 10.0; Win64; x64',
    platform: 'Win32',
    oscpuFragment: 'Windows NT 10.0; Win64; x64',
  },
  {
    uaFragment: 'Macintosh; Intel Mac OS X 10_15_7',
    platform: 'MacIntel',
    oscpuFragment: 'Intel Mac OS X 10.15',
  },
  {
    uaFragment: 'X11; Linux x86_64',
    platform: 'Linux',
    oscpuFragment: 'Linux x86_64',
  },
];

/** Arbitrary that picks one of the three OS profiles. */
const arbOsProfile: fc.Arbitrary<OsProfile> = fc.constantFrom(...osProfiles);

/** Non-empty font name (printable ASCII, 1–30 chars). */
const arbFontName = fc.stringOf(
  fc.char().filter((c) => c.charCodeAt(0) >= 33 && c.charCodeAt(0) < 127),
  { minLength: 1, maxLength: 30 },
);

/** Font list: array of non-empty font names. */
const arbFontList = fc.array(arbFontName, { minLength: 1, maxLength: 15 });

/** Valid CPU cores in range [1, 32]. */
const arbCpuCores = fc.integer({ min: 1, max: 32 });

/** Valid RAM in range [1, 64]. */
const arbRamGB = fc.integer({ min: 1, max: 64 });

/** Build a valid, OS-consistent FingerprintConfig. */
const arbFingerprintConfig: fc.Arbitrary<FingerprintConfig> = fc
  .tuple(
    fc.double({ min: 0, max: 1, noNaN: true }),   // canvas noiseLevel
    fc.double({ min: 0, max: 1, noNaN: true }),   // webgl noiseLevel
    fc.double({ min: -1, max: 1, noNaN: true }),  // audioContext frequencyOffset
    arbCpuCores,
    arbRamGB,
    arbFontList,
    fc.constantFrom('disable' as const, 'proxy' as const, 'real' as const),
    arbOsProfile,
  )
  .map(([canvasNoise, webglNoise, freqOffset, cores, ram, fonts, webrtc, os]) => ({
    canvas: { noiseLevel: canvasNoise },
    webgl: { noiseLevel: webglNoise },
    audioContext: { frequencyOffset: freqOffset },
    cpu: { cores },
    ram: { sizeGB: ram },
    userAgent: `Mozilla/5.0 (${os.uaFragment}) AppleWebKit/537.36`,
    fonts,
    webrtc,
    platform: os.platform,
    appVersion: `5.0 (${os.uaFragment})`,
    oscpu: os.oscpuFragment,
  }));

/**
 * Build two FingerprintConfigs that differ in at least one fingerprint-relevant
 * field (canvas noise, webgl noise, or audio frequency offset).
 */
const arbTwoDifferentConfigs: fc.Arbitrary<[FingerprintConfig, FingerprintConfig]> = fc
  .tuple(arbFingerprintConfig, arbFingerprintConfig)
  .filter(
    ([a, b]) =>
      a.canvas.noiseLevel !== b.canvas.noiseLevel ||
      a.webgl.noiseLevel !== b.webgl.noiseLevel ||
      a.audioContext.frequencyOffset !== b.audioContext.frequencyOffset,
  );

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('FingerprintSpoofer property tests', () => {
  const spoofer = new FingerprintSpoofer();

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * Property 7: Fingerprint phần cứng khác biệt giữa các hồ sơ
   *
   * For any two different fingerprint configs, the generated Canvas hash,
   * WebGL hash, and AudioContext frequency values must be different.
   */
  it(
    propertyTag(7, 'Fingerprint phần cứng khác biệt giữa các hồ sơ'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbTwoDifferentConfigs, async ([config1, config2]) => {
          const fp1 = spoofer.generateFingerprint(config1);
          const fp2 = spoofer.generateFingerprint(config2);

          // Seeds must be different because generateFingerprint uses randomUUID
          // for each call, ensuring uniqueness even for identical configs.
          // For different configs, the prefix portion also differs.
          return (
            fp1.canvasSeed !== fp2.canvasSeed &&
            fp1.webglSeed !== fp2.webglSeed &&
            fp1.audioSeed !== fp2.audioSeed
          );
        }),
      );
    },
  );

  /**
   * **Validates: Requirements 3.4, 3.5**
   *
   * Property 8: Giá trị phần cứng ảo trong phạm vi hợp lệ
   *
   * For any fingerprint config, CPU cores must be in [1, 32] and RAM must be
   * in [1, 64] GB. Values outside this range must be rejected.
   */
  it(
    propertyTag(8, 'Giá trị phần cứng ảo trong phạm vi hợp lệ'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          arbCpuCores,
          arbRamGB,
          fc.integer({ min: -100, max: 0 }).chain((lowCpu) =>
            fc.integer({ min: 33, max: 200 }).map((highCpu) => ({ lowCpu, highCpu })),
          ),
          fc.integer({ min: -100, max: 0 }).chain((lowRam) =>
            fc.integer({ min: 65, max: 200 }).map((highRam) => ({ lowRam, highRam })),
          ),
          async (validCores, validRam, cpuBounds, ramBounds) => {
            // Valid values must produce a script without throwing
            const script = generateHardwareScript(validCores, validRam);
            if (typeof script !== 'string' || script.length === 0) return false;

            // Invalid CPU cores (below range) must throw
            let threwLowCpu = false;
            try {
              generateHardwareScript(cpuBounds.lowCpu, validRam);
            } catch {
              threwLowCpu = true;
            }
            if (!threwLowCpu) return false;

            // Invalid CPU cores (above range) must throw
            let threwHighCpu = false;
            try {
              generateHardwareScript(cpuBounds.highCpu, validRam);
            } catch {
              threwHighCpu = true;
            }
            if (!threwHighCpu) return false;

            // Invalid RAM (below range) must throw
            let threwLowRam = false;
            try {
              generateHardwareScript(validCores, ramBounds.lowRam);
            } catch {
              threwLowRam = true;
            }
            if (!threwLowRam) return false;

            // Invalid RAM (above range) must throw
            let threwHighRam = false;
            try {
              generateHardwareScript(validCores, ramBounds.highRam);
            } catch {
              threwHighRam = true;
            }
            if (!threwHighRam) return false;

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 3.6**
   *
   * Property 9: Fingerprint nhất quán trong phiên làm việc
   *
   * For any active browser profile, reading fingerprint hardware values
   * multiple times in the same session must always return the same value.
   * We test this by verifying that generateHardwareScript is deterministic
   * given the same CPU/RAM inputs (same seed → same output).
   */
  it(
    propertyTag(9, 'Fingerprint nhất quán trong phiên làm việc'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbFingerprintConfig, async (config) => {
          // The hardware script is deterministic given the same inputs
          const script1 = generateHardwareScript(config.cpu.cores, config.ram.sizeGB);
          const script2 = generateHardwareScript(config.cpu.cores, config.ram.sizeGB);
          if (script1 !== script2) return false;

          // The UA script is deterministic given the same inputs
          const { generateUserAgentScript } = await import('../injection-scripts');
          const uaScript1 = generateUserAgentScript(
            config.userAgent,
            config.appVersion,
            config.platform,
            config.oscpu,
          );
          const uaScript2 = generateUserAgentScript(
            config.userAgent,
            config.appVersion,
            config.platform,
            config.oscpu,
          );
          if (uaScript1 !== uaScript2) return false;

          // The font list script is deterministic given the same inputs
          const fontScript1 = generateFontListScript(config.fonts);
          const fontScript2 = generateFontListScript(config.fonts);
          if (fontScript1 !== fontScript2) return false;

          return true;
        }),
      );
    },
  );

  /**
   * **Validates: Requirements 4.5**
   *
   * Property 10: Nhất quán User-Agent với navigator properties
   *
   * For any fingerprint config, User-Agent, platform, appVersion, and oscpu
   * must be consistent (e.g., UA contains "Windows" → platform is "Win32").
   */
  it(
    propertyTag(10, 'Nhất quán User-Agent với navigator properties'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbFingerprintConfig, async (config) => {
          const fp = spoofer.generateFingerprint(config);
          const result = spoofer.validateConsistency(fp);

          // Our generator always produces OS-consistent configs,
          // so validateConsistency must always return valid.
          return result.isValid === true && result.errors.length === 0;
        }),
      );
    },
  );

  /**
   * **Validates: Requirements 4.2**
   *
   * Property 11: Giới hạn font theo cấu hình hồ sơ
   *
   * For any profile with a configured font list, the set of fonts detectable
   * by websites must be a subset of the configured font list.
   * We verify this by checking that the generated font list script only
   * allows fonts from the configured list.
   */
  it(
    propertyTag(11, 'Giới hạn font theo cấu hình hồ sơ'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          arbFontList,
          arbFontName,
          async (configuredFonts, extraFont) => {
            const script = generateFontListScript(configuredFonts);

            // The script must contain the ALLOWED_FONTS array
            if (!script.includes('ALLOWED_FONTS')) return false;

            // All configured fonts must appear in the script
            for (const font of configuredFonts) {
              if (!script.includes(JSON.stringify(font).slice(1, -1))) return false;
            }

            // The script uses a case-insensitive Set for matching
            if (!script.includes('toLowerCase')) return false;

            // The script overrides document.fonts.check to filter fonts
            if (!script.includes('document.fonts')) return false;

            // Verify the ALLOWED_FONTS array in the script matches exactly
            // the configured fonts (no extra fonts added)
            const allowedFontsJson = JSON.stringify(configuredFonts);
            if (!script.includes(allowedFontsJson)) return false;

            // If extraFont is NOT in the configured list (case-insensitive),
            // it should not be in the allowed set. We verify the script
            // structure ensures only configured fonts pass the check.
            const configuredLower = new Set(configuredFonts.map((f) => f.toLowerCase()));
            if (!configuredLower.has(extraFont.toLowerCase())) {
              // The script's allowedSet won't contain this font,
              // so document.fonts.check would return false for it.
              // We verify the script logic is correct by checking the
              // allowedSet construction uses the exact configured fonts.
              if (!script.includes('allowedSet.has(family.toLowerCase())')) return false;
            }

            return true;
          },
        ),
      );
    },
  );
});
