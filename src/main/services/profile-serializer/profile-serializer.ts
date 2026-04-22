/**
 * Profile Serializer Service
 *
 * Tuần tự hóa và phân tích cấu hình hồ sơ dưới dạng JSON:
 * serialize, deserialize, validate với thông báo lỗi cụ thể.
 *
 * Implements IProfileSerializer from the design document.
 */

import type { ProfileConfig, FingerprintConfig, ValidationResult } from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';

/** Required top-level fields in a serialized ProfileConfig. */
const REQUIRED_TOP_LEVEL_FIELDS: (keyof ProfileConfig)[] = ['name', 'browserType', 'fingerprint'];

/** Required sub-fields within FingerprintConfig. */
const REQUIRED_FINGERPRINT_FIELDS: (keyof FingerprintConfig)[] = [
  'canvas',
  'webgl',
  'audioContext',
  'cpu',
  'ram',
  'userAgent',
  'fonts',
  'webrtc',
  'platform',
  'appVersion',
  'oscpu',
];

/** Valid browser types. */
const VALID_BROWSER_TYPES = ['chromium', 'firefox'];

/** Valid webrtc modes. */
const VALID_WEBRTC_MODES = ['disable', 'proxy', 'real'];

/**
 * Deterministic JSON.stringify with sorted keys.
 * Ensures serialize output is consistent regardless of property insertion order.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = val[k];
      }
      return sorted;
    }
    return val;
  });
}

export class ProfileSerializer {
  /**
   * Task 12.1: serialize()
   *
   * Converts a ProfileConfig to a deterministic JSON string.
   * Includes fingerprint, proxy, and extensions fields.
   * Uses sorted keys for deterministic output.
   */
  serialize(config: ProfileConfig): string {
    const serializable: Record<string, unknown> = {
      name: config.name,
      browserType: config.browserType,
      fingerprint: config.fingerprint,
    };

    if (config.proxy !== undefined) {
      serializable.proxy = config.proxy;
    }

    if (config.extensions !== undefined) {
      serializable.extensions = config.extensions;
    }

    return stableStringify(serializable);
  }

  /**
   * Task 12.2: deserialize()
   *
   * Parses a JSON string into a ProfileConfig.
   * Throws INVALID_JSON (7001) if parsing fails.
   * Throws MISSING_REQUIRED_FIELD (7002) if required fields are missing.
   */
  deserialize(json: string): ProfileConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      const error = new Error('Invalid JSON: unable to parse input');
      (error as Error & { code: number }).code = AppErrorCode.INVALID_JSON;
      throw error;
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('Invalid JSON: expected an object');
      (error as Error & { code: number }).code = AppErrorCode.INVALID_JSON;
      throw error;
    }

    const obj = parsed as Record<string, unknown>;

    // Check required top-level fields
    for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
      if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
        const error = new Error(`Missing required field: ${field}`);
        (error as Error & { code: number }).code = AppErrorCode.MISSING_REQUIRED_FIELD;
        throw error;
      }
    }

    // Validate fingerprint is an object
    if (typeof obj.fingerprint !== 'object' || Array.isArray(obj.fingerprint)) {
      const error = new Error('Missing required field: fingerprint must be an object');
      (error as Error & { code: number }).code = AppErrorCode.MISSING_REQUIRED_FIELD;
      throw error;
    }

    const fp = obj.fingerprint as Record<string, unknown>;

    // Check required fingerprint sub-fields
    for (const field of REQUIRED_FINGERPRINT_FIELDS) {
      if (!(field in fp) || fp[field] === undefined || fp[field] === null) {
        const error = new Error(`Missing required field: fingerprint.${field}`);
        (error as Error & { code: number }).code = AppErrorCode.MISSING_REQUIRED_FIELD;
        throw error;
      }
    }

    const config: ProfileConfig = {
      name: obj.name as string,
      browserType: obj.browserType as 'chromium' | 'firefox',
      fingerprint: obj.fingerprint as FingerprintConfig,
    };

    if (obj.proxy !== undefined && obj.proxy !== null) {
      config.proxy = obj.proxy as ProfileConfig['proxy'];
    }

    if (obj.extensions !== undefined && obj.extensions !== null) {
      config.extensions = obj.extensions as string[];
    }

    return config;
  }

  /**
   * Task 12.3: validate()
   *
   * Checks JSON validity and returns specific error messages for missing/wrong fields.
   * Returns ValidationResult { isValid, errors[] }.
   */
  validate(json: string): ValidationResult {
    const errors: string[] = [];

    // Step 1: Check if JSON is parseable
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { isValid: false, errors: ['Invalid JSON: unable to parse input'] };
    }

    // Step 2: Check it's an object
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { isValid: false, errors: ['Invalid JSON: expected an object'] };
    }

    const obj = parsed as Record<string, unknown>;

    // Step 3: Check required top-level fields
    for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
      if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Step 4: Validate field types for present fields
    if ('name' in obj && obj.name !== undefined && obj.name !== null) {
      if (typeof obj.name !== 'string') {
        errors.push('Invalid field value: name must be a string');
      }
    }

    if ('browserType' in obj && obj.browserType !== undefined && obj.browserType !== null) {
      if (typeof obj.browserType !== 'string' || !VALID_BROWSER_TYPES.includes(obj.browserType)) {
        errors.push("Invalid field value: browserType must be 'chromium' or 'firefox'");
      }
    }

    // Step 5: Validate fingerprint sub-fields if fingerprint is present
    if ('fingerprint' in obj && obj.fingerprint !== undefined && obj.fingerprint !== null) {
      if (typeof obj.fingerprint !== 'object' || Array.isArray(obj.fingerprint)) {
        errors.push('Invalid field value: fingerprint must be an object');
      } else {
        const fp = obj.fingerprint as Record<string, unknown>;

        for (const field of REQUIRED_FINGERPRINT_FIELDS) {
          if (!(field in fp) || fp[field] === undefined || fp[field] === null) {
            errors.push(`Missing required field: fingerprint.${field}`);
          }
        }

        // Validate fingerprint field types for present fields
        this.validateFingerprintFieldTypes(fp, errors);
      }
    }

    // Step 6: Validate optional fields if present
    if ('proxy' in obj && obj.proxy !== undefined && obj.proxy !== null) {
      if (typeof obj.proxy !== 'object' || Array.isArray(obj.proxy)) {
        errors.push('Invalid field value: proxy must be an object');
      }
    }

    if ('extensions' in obj && obj.extensions !== undefined && obj.extensions !== null) {
      if (!Array.isArray(obj.extensions)) {
        errors.push('Invalid field value: extensions must be an array');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates fingerprint field types and adds errors for invalid values.
   */
  private validateFingerprintFieldTypes(fp: Record<string, unknown>, errors: string[]): void {
    // canvas
    if ('canvas' in fp && fp.canvas !== undefined && fp.canvas !== null) {
      if (typeof fp.canvas !== 'object' || Array.isArray(fp.canvas)) {
        errors.push('Invalid field value: fingerprint.canvas must be an object');
      } else {
        const canvas = fp.canvas as Record<string, unknown>;
        if ('noiseLevel' in canvas && typeof canvas.noiseLevel !== 'number') {
          errors.push('Invalid field value: fingerprint.canvas.noiseLevel must be a number');
        }
      }
    }

    // webgl
    if ('webgl' in fp && fp.webgl !== undefined && fp.webgl !== null) {
      if (typeof fp.webgl !== 'object' || Array.isArray(fp.webgl)) {
        errors.push('Invalid field value: fingerprint.webgl must be an object');
      } else {
        const webgl = fp.webgl as Record<string, unknown>;
        if ('noiseLevel' in webgl && typeof webgl.noiseLevel !== 'number') {
          errors.push('Invalid field value: fingerprint.webgl.noiseLevel must be a number');
        }
      }
    }

    // audioContext
    if ('audioContext' in fp && fp.audioContext !== undefined && fp.audioContext !== null) {
      if (typeof fp.audioContext !== 'object' || Array.isArray(fp.audioContext)) {
        errors.push('Invalid field value: fingerprint.audioContext must be an object');
      }
    }

    // cpu
    if ('cpu' in fp && fp.cpu !== undefined && fp.cpu !== null) {
      if (typeof fp.cpu !== 'object' || Array.isArray(fp.cpu)) {
        errors.push('Invalid field value: fingerprint.cpu must be an object');
      } else {
        const cpu = fp.cpu as Record<string, unknown>;
        if ('cores' in cpu && typeof cpu.cores === 'number') {
          if (cpu.cores < 1 || cpu.cores > 32) {
            errors.push('Invalid field value: fingerprint.cpu.cores must be between 1 and 32');
          }
        }
      }
    }

    // ram
    if ('ram' in fp && fp.ram !== undefined && fp.ram !== null) {
      if (typeof fp.ram !== 'object' || Array.isArray(fp.ram)) {
        errors.push('Invalid field value: fingerprint.ram must be an object');
      } else {
        const ram = fp.ram as Record<string, unknown>;
        if ('sizeGB' in ram && typeof ram.sizeGB === 'number') {
          if (ram.sizeGB < 1 || ram.sizeGB > 64) {
            errors.push('Invalid field value: fingerprint.ram.sizeGB must be between 1 and 64');
          }
        }
      }
    }

    // userAgent
    if ('userAgent' in fp && fp.userAgent !== undefined && fp.userAgent !== null) {
      if (typeof fp.userAgent !== 'string') {
        errors.push('Invalid field value: fingerprint.userAgent must be a string');
      }
    }

    // fonts
    if ('fonts' in fp && fp.fonts !== undefined && fp.fonts !== null) {
      if (!Array.isArray(fp.fonts)) {
        errors.push('Invalid field value: fingerprint.fonts must be an array');
      }
    }

    // webrtc
    if ('webrtc' in fp && fp.webrtc !== undefined && fp.webrtc !== null) {
      if (typeof fp.webrtc !== 'string' || !VALID_WEBRTC_MODES.includes(fp.webrtc)) {
        errors.push("Invalid field value: fingerprint.webrtc must be 'disable', 'proxy', or 'real'");
      }
    }

    // platform
    if ('platform' in fp && fp.platform !== undefined && fp.platform !== null) {
      if (typeof fp.platform !== 'string') {
        errors.push('Invalid field value: fingerprint.platform must be a string');
      }
    }

    // appVersion
    if ('appVersion' in fp && fp.appVersion !== undefined && fp.appVersion !== null) {
      if (typeof fp.appVersion !== 'string') {
        errors.push('Invalid field value: fingerprint.appVersion must be a string');
      }
    }

    // oscpu
    if ('oscpu' in fp && fp.oscpu !== undefined && fp.oscpu !== null) {
      if (typeof fp.oscpu !== 'string') {
        errors.push('Invalid field value: fingerprint.oscpu must be a string');
      }
    }
  }
}
