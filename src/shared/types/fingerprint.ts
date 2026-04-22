/**
 * Fingerprint Spoofer types.
 * Types for generating and applying browser fingerprint spoofing.
 */

/** Configuration for fingerprint spoofing per browser profile. */
export interface FingerprintConfig {
  canvas: { noiseLevel: number }; // 0.0 - 1.0
  webgl: { noiseLevel: number };
  audioContext: { frequencyOffset: number };
  cpu: { cores: number }; // 1-32
  ram: { sizeGB: number }; // 1-64
  userAgent: string;
  fonts: string[];
  webrtc: 'disable' | 'proxy' | 'real';
  platform: string;
  appVersion: string;
  oscpu: string;
}

/** Generated fingerprint data including seeds for deterministic noise. */
export interface FingerprintData {
  config: FingerprintConfig;
  canvasSeed: string;
  webglSeed: string;
  audioSeed: string;
}

/** Result of fingerprint consistency validation. */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
