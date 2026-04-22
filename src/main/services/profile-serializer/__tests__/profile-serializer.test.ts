/**
 * Unit tests for Profile Serializer (Tasks 12.1, 12.2, 12.3).
 *
 * Tests serialize, deserialize, and validate methods with specific examples
 * and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProfileSerializer } from '../profile-serializer';
import type { ProfileConfig } from '../../../../shared/types';
import { AppErrorCode } from '../../../../shared/types';

/** Helper to create a valid ProfileConfig for testing. */
function makeProfileConfig(overrides?: Partial<ProfileConfig>): ProfileConfig {
  return {
    name: 'Test Profile',
    browserType: 'chromium',
    fingerprint: {
      canvas: { noiseLevel: 0.5 },
      webgl: { noiseLevel: 0.3 },
      audioContext: { frequencyOffset: 0.01 },
      cpu: { cores: 4 },
      ram: { sizeGB: 8 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      fonts: ['Arial', 'Verdana'],
      webrtc: 'disable',
      platform: 'Win32',
      appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
      oscpu: 'Windows NT 10.0; Win64; x64',
    },
    ...overrides,
  };
}

describe('ProfileSerializer', () => {
  let serializer: ProfileSerializer;

  beforeEach(() => {
    serializer = new ProfileSerializer();
  });

  // --- Task 12.1: serialize() ---

  describe('serialize', () => {
    it('should serialize a basic ProfileConfig to JSON string', () => {
      const config = makeProfileConfig();
      const json = serializer.serialize(config);
      const parsed = JSON.parse(json);

      expect(parsed.name).toBe('Test Profile');
      expect(parsed.browserType).toBe('chromium');
      expect(parsed.fingerprint).toBeDefined();
      expect(parsed.fingerprint.canvas.noiseLevel).toBe(0.5);
    });

    it('should include fingerprint fields in output', () => {
      const config = makeProfileConfig();
      const json = serializer.serialize(config);
      const parsed = JSON.parse(json);

      expect(parsed.fingerprint.canvas).toEqual({ noiseLevel: 0.5 });
      expect(parsed.fingerprint.webgl).toEqual({ noiseLevel: 0.3 });
      expect(parsed.fingerprint.audioContext).toEqual({ frequencyOffset: 0.01 });
      expect(parsed.fingerprint.cpu).toEqual({ cores: 4 });
      expect(parsed.fingerprint.ram).toEqual({ sizeGB: 8 });
      expect(parsed.fingerprint.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      expect(parsed.fingerprint.fonts).toEqual(['Arial', 'Verdana']);
      expect(parsed.fingerprint.webrtc).toBe('disable');
      expect(parsed.fingerprint.platform).toBe('Win32');
      expect(parsed.fingerprint.appVersion).toBe('5.0 (Windows NT 10.0; Win64; x64)');
      expect(parsed.fingerprint.oscpu).toBe('Windows NT 10.0; Win64; x64');
    });

    it('should include proxy when present', () => {
      const config = makeProfileConfig({
        proxy: { protocol: 'http', host: '127.0.0.1', port: 8080, username: 'user', password: 'pass' },
      });
      const json = serializer.serialize(config);
      const parsed = JSON.parse(json);

      expect(parsed.proxy).toEqual({
        protocol: 'http',
        host: '127.0.0.1',
        port: 8080,
        username: 'user',
        password: 'pass',
      });
    });

    it('should include extensions when present', () => {
      const config = makeProfileConfig({ extensions: ['ext-1', 'ext-2'] });
      const json = serializer.serialize(config);
      const parsed = JSON.parse(json);

      expect(parsed.extensions).toEqual(['ext-1', 'ext-2']);
    });

    it('should omit proxy when undefined', () => {
      const config = makeProfileConfig();
      const json = serializer.serialize(config);
      const parsed = JSON.parse(json);

      expect(parsed.proxy).toBeUndefined();
    });

    it('should omit extensions when undefined', () => {
      const config = makeProfileConfig();
      const json = serializer.serialize(config);
      const parsed = JSON.parse(json);

      expect(parsed.extensions).toBeUndefined();
    });

    it('should produce deterministic output with sorted keys', () => {
      const config = makeProfileConfig();
      const json1 = serializer.serialize(config);
      const json2 = serializer.serialize(config);

      expect(json1).toBe(json2);
    });

    it('should serialize firefox browser type', () => {
      const config = makeProfileConfig({ browserType: 'firefox' });
      const json = serializer.serialize(config);
      const parsed = JSON.parse(json);

      expect(parsed.browserType).toBe('firefox');
    });
  });

  // --- Task 12.2: deserialize() ---

  describe('deserialize', () => {
    it('should deserialize a valid JSON string to ProfileConfig', () => {
      const config = makeProfileConfig();
      const json = serializer.serialize(config);
      const result = serializer.deserialize(json);

      expect(result.name).toBe('Test Profile');
      expect(result.browserType).toBe('chromium');
      expect(result.fingerprint.canvas.noiseLevel).toBe(0.5);
    });

    it('should preserve proxy in deserialized output', () => {
      const config = makeProfileConfig({
        proxy: { protocol: 'socks5', host: '10.0.0.1', port: 1080 },
      });
      const json = serializer.serialize(config);
      const result = serializer.deserialize(json);

      expect(result.proxy).toEqual({ protocol: 'socks5', host: '10.0.0.1', port: 1080 });
    });

    it('should preserve extensions in deserialized output', () => {
      const config = makeProfileConfig({ extensions: ['ext-a', 'ext-b'] });
      const json = serializer.serialize(config);
      const result = serializer.deserialize(json);

      expect(result.extensions).toEqual(['ext-a', 'ext-b']);
    });

    it('should throw INVALID_JSON for unparseable input', () => {
      try {
        serializer.deserialize('not valid json {{{');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.INVALID_JSON);
        expect(error.message).toContain('Invalid JSON');
      }
    });

    it('should throw INVALID_JSON for non-object JSON', () => {
      try {
        serializer.deserialize('"just a string"');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.INVALID_JSON);
      }
    });

    it('should throw INVALID_JSON for array JSON', () => {
      try {
        serializer.deserialize('[1, 2, 3]');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.INVALID_JSON);
      }
    });

    it('should throw INVALID_JSON for null JSON', () => {
      try {
        serializer.deserialize('null');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.INVALID_JSON);
      }
    });

    it('should throw MISSING_REQUIRED_FIELD when name is missing', () => {
      const json = JSON.stringify({
        browserType: 'chromium',
        fingerprint: makeProfileConfig().fingerprint,
      });

      try {
        serializer.deserialize(json);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.MISSING_REQUIRED_FIELD);
        expect(error.message).toContain('name');
      }
    });

    it('should throw MISSING_REQUIRED_FIELD when browserType is missing', () => {
      const json = JSON.stringify({
        name: 'Test',
        fingerprint: makeProfileConfig().fingerprint,
      });

      try {
        serializer.deserialize(json);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.MISSING_REQUIRED_FIELD);
        expect(error.message).toContain('browserType');
      }
    });

    it('should throw MISSING_REQUIRED_FIELD when fingerprint is missing', () => {
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
      });

      try {
        serializer.deserialize(json);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.MISSING_REQUIRED_FIELD);
        expect(error.message).toContain('fingerprint');
      }
    });

    it('should throw MISSING_REQUIRED_FIELD when fingerprint sub-field is missing', () => {
      const fp = { ...makeProfileConfig().fingerprint } as Record<string, unknown>;
      delete fp.canvas;

      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
        fingerprint: fp,
      });

      try {
        serializer.deserialize(json);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.MISSING_REQUIRED_FIELD);
        expect(error.message).toContain('fingerprint.canvas');
      }
    });

    it('should handle empty string input', () => {
      try {
        serializer.deserialize('');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.INVALID_JSON);
      }
    });
  });

  // --- Task 12.3: validate() ---

  describe('validate', () => {
    it('should return isValid=true for a valid ProfileConfig JSON', () => {
      const config = makeProfileConfig();
      const json = serializer.serialize(config);
      const result = serializer.validate(json);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for unparseable JSON', () => {
      const result = serializer.validate('{{invalid}}');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid JSON: unable to parse input');
    });

    it('should return error for non-object JSON', () => {
      const result = serializer.validate('"string"');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid JSON: expected an object');
    });

    it('should return error for missing name', () => {
      const json = JSON.stringify({
        browserType: 'chromium',
        fingerprint: makeProfileConfig().fingerprint,
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: name');
    });

    it('should return error for missing browserType', () => {
      const json = JSON.stringify({
        name: 'Test',
        fingerprint: makeProfileConfig().fingerprint,
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: browserType');
    });

    it('should return error for missing fingerprint', () => {
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: fingerprint');
    });

    it('should return error for invalid browserType value', () => {
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'safari',
        fingerprint: makeProfileConfig().fingerprint,
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('browserType'))).toBe(true);
    });

    it('should return errors for missing fingerprint sub-fields', () => {
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
        fingerprint: { canvas: { noiseLevel: 0.5 } },
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('fingerprint.webgl'))).toBe(true);
      expect(result.errors.some((e) => e.includes('fingerprint.audioContext'))).toBe(true);
      expect(result.errors.some((e) => e.includes('fingerprint.cpu'))).toBe(true);
    });

    it('should return multiple errors at once', () => {
      const json = JSON.stringify({});
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors).toContain('Missing required field: name');
      expect(result.errors).toContain('Missing required field: browserType');
      expect(result.errors).toContain('Missing required field: fingerprint');
    });

    it('should return error for invalid webrtc value', () => {
      const fp = { ...makeProfileConfig().fingerprint, webrtc: 'invalid' };
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
        fingerprint: fp,
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('webrtc'))).toBe(true);
    });

    it('should return error for cpu.cores out of range', () => {
      const fp = { ...makeProfileConfig().fingerprint, cpu: { cores: 64 } };
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
        fingerprint: fp,
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('cpu.cores'))).toBe(true);
    });

    it('should return error for ram.sizeGB out of range', () => {
      const fp = { ...makeProfileConfig().fingerprint, ram: { sizeGB: 128 } };
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
        fingerprint: fp,
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('ram.sizeGB'))).toBe(true);
    });

    it('should validate with proxy and extensions present', () => {
      const config = makeProfileConfig({
        proxy: { protocol: 'https', host: 'proxy.example.com', port: 443 },
        extensions: ['ext-1'],
      });
      const json = serializer.serialize(config);
      const result = serializer.validate(json);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for invalid extensions type', () => {
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
        fingerprint: makeProfileConfig().fingerprint,
        extensions: 'not-an-array',
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('extensions'))).toBe(true);
    });

    it('should return error for invalid proxy type', () => {
      const json = JSON.stringify({
        name: 'Test',
        browserType: 'chromium',
        fingerprint: makeProfileConfig().fingerprint,
        proxy: 'not-an-object',
      });
      const result = serializer.validate(json);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('proxy'))).toBe(true);
    });
  });
});
