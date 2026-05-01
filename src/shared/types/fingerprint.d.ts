/**
 * Fingerprint Spoofer types.
 * Types for generating and applying browser fingerprint spoofing.
 */
/** Configuration for fingerprint spoofing per browser profile. */
export interface FingerprintConfig {
    canvas: {
        noiseLevel: number;
    };
    webgl: {
        noiseLevel: number;
    };
    audioContext: {
        frequencyOffset: number;
    };
    cpu: {
        cores: number;
    };
    ram: {
        sizeGB: number;
    };
    userAgent: string;
    fonts: string[];
    webrtc: 'disable' | 'proxy' | 'real';
    platform: string;
    appVersion: string;
    oscpu: string;
    timezone: string;
    locale: string;
    screen: {
        width: number;
        height: number;
        colorDepth: number;
    };
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
//# sourceMappingURL=fingerprint.d.ts.map