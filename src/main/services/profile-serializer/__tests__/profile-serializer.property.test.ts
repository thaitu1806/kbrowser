/**
 * Property-based tests for Profile Serializer (P31, P32).
 *
 * Uses fast-check to verify correctness properties defined in the design document.
 */

import { describe, it, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ProfileSerializer } from '../profile-serializer';
import type { ProfileConfig } from '../../../../shared/types';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Printable ASCII string (no control chars). */
const arbPrintableString = (minLen: number, maxLen: number) =>
  fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
    { minLength: minLen, maxLength: maxLen },
  );

/** Valid FingerprintConfig arbitrary. */
const arbFingerprintConfig = fc.record({
  canvas: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
  webgl: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
  audioContext: fc.record({
    frequencyOffset: fc.double({ min: -1, max: 1, noNaN: true }),
  }),
  cpu: fc.record({ cores: fc.integer({ min: 1, max: 32 }) }),
  ram: fc.record({ sizeGB: fc.integer({ min: 1, max: 64 }) }),
  userAgent: arbPrintableString(1, 100),
  fonts: fc.array(arbPrintableString(1, 30), { minLength: 0, maxLength: 5 }),
  webrtc: fc.constantFrom('disable' as const, 'proxy' as const, 'real' as const),
  platform: arbPrintableString(1, 30),
  appVersion: arbPrintableString(1, 60),
  oscpu: arbPrintableString(1, 60),
});

/** Valid ProxyConfig arbitrary. */
const arbProxyConfig = fc.record({
  protocol: fc.constantFrom('http' as const, 'https' as const, 'socks5' as const),
  host: arbPrintableString(1, 50),
  port: fc.integer({ min: 1, max: 65535 }),
  username: fc.option(arbPrintableString(1, 30), { nil: undefined }),
  password: fc.option(arbPrintableString(1, 30), { nil: undefined }),
});

/** Valid ProfileConfig arbitrary (with optional proxy and extensions). */
const arbProfileConfig: fc.Arbitrary<ProfileConfig> = fc.record({
  name: arbPrintableString(1, 50),
  browserType: fc.constantFrom('chromium' as const, 'firefox' as const),
  fingerprint: arbFingerprintConfig,
  proxy: fc.option(arbProxyConfig, { nil: undefined }),
  extensions: fc.option(
    fc.array(arbPrintableString(1, 30), { minLength: 0, maxLength: 5 }),
    { nil: undefined },
  ),
});

/** Required fingerprint sub-field names. */
const FINGERPRINT_FIELDS = [
  'canvas', 'webgl', 'audioContext', 'cpu', 'ram',
  'userAgent', 'fonts', 'webrtc', 'platform', 'appVersion', 'oscpu',
];

/** Required top-level field names. */
const TOP_LEVEL_FIELDS = ['name', 'browserType', 'fingerprint'];

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('ProfileSerializer property tests', () => {
  let serializer: ProfileSerializer;

  beforeEach(() => {
    serializer = new ProfileSerializer();
  });

  /**
   * **Validates: Requirements 14.1, 14.2, 14.3**
   *
   * Property 31: Round-trip tuần tự hóa cấu hình hồ sơ
   *
   * For any valid ProfileConfig, serialize → deserialize → serialize
   * must produce equivalent JSON.
   */
  it(
    propertyTag(31, 'Round-trip tuần tự hóa cấu hình hồ sơ'),
    async () => {
      await assertProperty(
        fc.property(arbProfileConfig, (config: ProfileConfig) => {
          // Step 1: serialize the config
          const json1 = serializer.serialize(config);

          // Step 2: deserialize back to ProfileConfig
          const deserialized = serializer.deserialize(json1);

          // Step 3: serialize again
          const json2 = serializer.serialize(deserialized);

          // The two JSON strings must be identical (deterministic output)
          return json1 === json2;
        }),
      );
    },
  );

  /**
   * **Validates: Requirements 14.4**
   *
   * Property 32: Thông báo lỗi cụ thể cho JSON không hợp lệ
   *
   * For any invalid JSON or missing fields, validate must return
   * specific error messages.
   */
  it(
    propertyTag(32, 'Thông báo lỗi cụ thể cho JSON không hợp lệ'),
    async () => {
      // Sub-property 32a: Non-parseable strings produce parse error
      await assertProperty(
        fc.property(
          fc.string().filter((s) => {
            try { JSON.parse(s); return false; } catch { return true; }
          }),
          (invalidJson: string) => {
            const result = serializer.validate(invalidJson);
            if (result.isValid) return false;
            if (result.errors.length === 0) return false;
            if (!result.errors.some((e) => e.includes('Invalid JSON'))) return false;
            return true;
          },
        ),
      );

      // Sub-property 32b: Missing a required top-level field produces specific error
      await assertProperty(
        fc.property(
          arbProfileConfig,
          fc.constantFrom(...TOP_LEVEL_FIELDS),
          (config: ProfileConfig, fieldToRemove: string) => {
            const json = serializer.serialize(config);
            const obj = JSON.parse(json);
            delete obj[fieldToRemove];
            const modifiedJson = JSON.stringify(obj);

            const result = serializer.validate(modifiedJson);
            if (result.isValid) return false;
            if (!result.errors.some((e) => e.includes(fieldToRemove))) return false;
            return true;
          },
        ),
      );

      // Sub-property 32c: Missing a required fingerprint sub-field produces specific error
      await assertProperty(
        fc.property(
          arbProfileConfig,
          fc.constantFrom(...FINGERPRINT_FIELDS),
          (config: ProfileConfig, fpFieldToRemove: string) => {
            const json = serializer.serialize(config);
            const obj = JSON.parse(json);
            delete obj.fingerprint[fpFieldToRemove];
            const modifiedJson = JSON.stringify(obj);

            const result = serializer.validate(modifiedJson);
            if (result.isValid) return false;
            if (!result.errors.some((e) => e.includes(`fingerprint.${fpFieldToRemove}`))) return false;
            return true;
          },
        ),
      );
    },
  );
});
