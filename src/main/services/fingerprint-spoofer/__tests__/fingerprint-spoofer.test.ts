import { describe, it, expect, vi } from 'vitest';
import { FingerprintSpoofer } from '../fingerprint-spoofer';
import type { BrowserContext } from '../fingerprint-spoofer';
import type { FingerprintConfig, FingerprintData } from '../../../../shared/types';
import {
  generateCanvasNoiseScript,
  generateWebGLNoiseScript,
  generateAudioNoiseScript,
  generateHardwareScript,
} from '../injection-scripts';

/** Helper to create a valid FingerprintConfig for testing. */
function makeConfig(overrides?: Partial<FingerprintConfig>): FingerprintConfig {
  return {
    canvas: { noiseLevel: 0.5 },
    webgl: { noiseLevel: 0.3 },
    audioContext: { frequencyOffset: 0.01 },
    cpu: { cores: 4 },
    ram: { sizeGB: 8 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    fonts: ['Arial', 'Verdana'],
    webrtc: 'disable' as const,
    platform: 'Win32',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
    oscpu: 'Windows NT 10.0; Win64; x64',
    ...overrides,
  };
}

/** Create a mock BrowserContext that tracks addInitScript calls. */
function createMockBrowserContext(): BrowserContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    addInitScript: vi.fn(async (script: string | { content: string }) => {
      const content = typeof script === 'string' ? script : script.content;
      calls.push(content);
    }),
  };
}

describe('FingerprintSpoofer.generateFingerprint', () => {
  const spoofer = new FingerprintSpoofer();

  it('should generate FingerprintData with all required fields', () => {
    const config = makeConfig();
    const data = spoofer.generateFingerprint(config);

    expect(data).toHaveProperty('config');
    expect(data).toHaveProperty('canvasSeed');
    expect(data).toHaveProperty('webglSeed');
    expect(data).toHaveProperty('audioSeed');
  });

  it('should return non-empty strings for all seeds', () => {
    const config = makeConfig();
    const data = spoofer.generateFingerprint(config);

    expect(typeof data.canvasSeed).toBe('string');
    expect(typeof data.webglSeed).toBe('string');
    expect(typeof data.audioSeed).toBe('string');
    expect(data.canvasSeed.length).toBeGreaterThan(0);
    expect(data.webglSeed.length).toBeGreaterThan(0);
    expect(data.audioSeed.length).toBeGreaterThan(0);
  });

  it('should preserve the config in the output', () => {
    const config = makeConfig({
      cpu: { cores: 16 },
      ram: { sizeGB: 32 },
      userAgent: 'Custom UA',
    });
    const data = spoofer.generateFingerprint(config);

    expect(data.config).toBe(config);
    expect(data.config.cpu.cores).toBe(16);
    expect(data.config.ram.sizeGB).toBe(32);
    expect(data.config.userAgent).toBe('Custom UA');
  });

  it('should generate unique seeds for different configs', () => {
    const config1 = makeConfig({ canvas: { noiseLevel: 0.1 } });
    const config2 = makeConfig({ canvas: { noiseLevel: 0.9 } });

    const data1 = spoofer.generateFingerprint(config1);
    const data2 = spoofer.generateFingerprint(config2);

    expect(data1.canvasSeed).not.toBe(data2.canvasSeed);
    expect(data1.webglSeed).not.toBe(data2.webglSeed);
    expect(data1.audioSeed).not.toBe(data2.audioSeed);
  });

  it('should generate unique seeds even for identical configs', () => {
    const config = makeConfig();

    const data1 = spoofer.generateFingerprint(config);
    const data2 = spoofer.generateFingerprint(config);

    // Due to the random UUID component, seeds should differ
    expect(data1.canvasSeed).not.toBe(data2.canvasSeed);
    expect(data1.webglSeed).not.toBe(data2.webglSeed);
    expect(data1.audioSeed).not.toBe(data2.audioSeed);
  });

  it('should include canvas noise level in the canvas seed', () => {
    const config = makeConfig({ canvas: { noiseLevel: 0.75 } });
    const data = spoofer.generateFingerprint(config);

    expect(data.canvasSeed).toContain('canvas-0.75');
  });

  it('should include webgl noise level in the webgl seed', () => {
    const config = makeConfig({ webgl: { noiseLevel: 0.42 } });
    const data = spoofer.generateFingerprint(config);

    expect(data.webglSeed).toContain('webgl-0.42');
  });

  it('should include audio frequency offset in the audio seed', () => {
    const config = makeConfig({ audioContext: { frequencyOffset: 0.05 } });
    const data = spoofer.generateFingerprint(config);

    expect(data.audioSeed).toContain('audio-0.05');
  });
});


describe('FingerprintSpoofer.applyFingerprint', () => {
  const spoofer = new FingerprintSpoofer();

  function makeFingerprint(configOverrides?: Partial<FingerprintConfig>): FingerprintData {
    const config = makeConfig(configOverrides);
    return spoofer.generateFingerprint(config);
  }

  it('should call addInitScript for each fingerprint component (4 base + UA, fonts, WebRTC)', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint();

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // canvas, webgl, audio, hardware, userAgent, fontList, webrtc(disable) = 7
    expect(mockContext.addInitScript).toHaveBeenCalledTimes(7);
  });

  it('should inject the canvas noise script with correct parameters', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ canvas: { noiseLevel: 0.7 } });

    const expectedScript = generateCanvasNoiseScript(
      fingerprint.canvasSeed,
      fingerprint.config.canvas.noiseLevel,
    );

    await spoofer.applyFingerprint(mockContext, fingerprint);

    expect(mockContext.calls[0]).toBe(expectedScript);
  });

  it('should inject the WebGL noise script with correct parameters', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ webgl: { noiseLevel: 0.6 } });

    const expectedScript = generateWebGLNoiseScript(
      fingerprint.webglSeed,
      fingerprint.config.webgl.noiseLevel,
    );

    await spoofer.applyFingerprint(mockContext, fingerprint);

    expect(mockContext.calls[1]).toBe(expectedScript);
  });

  it('should inject the audio noise script with correct parameters', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ audioContext: { frequencyOffset: 0.05 } });

    const expectedScript = generateAudioNoiseScript(
      fingerprint.audioSeed,
      fingerprint.config.audioContext.frequencyOffset,
    );

    await spoofer.applyFingerprint(mockContext, fingerprint);

    expect(mockContext.calls[2]).toBe(expectedScript);
  });

  it('should inject the hardware script with correct CPU and RAM values', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ cpu: { cores: 16 }, ram: { sizeGB: 32 } });

    const expectedScript = generateHardwareScript(
      fingerprint.config.cpu.cores,
      fingerprint.config.ram.sizeGB,
    );

    await spoofer.applyFingerprint(mockContext, fingerprint);

    expect(mockContext.calls[3]).toBe(expectedScript);
  });

  it('should inject scripts in order: canvas, webgl, audio, hardware', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint();

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // Verify order by checking that each script contains the expected marker
    expect(mockContext.calls[0]).toContain('HTMLCanvasElement');
    expect(mockContext.calls[1]).toContain('WebGLRenderingContext');
    expect(mockContext.calls[2]).toContain('AnalyserNode');
    expect(mockContext.calls[3]).toContain('hardwareConcurrency');
  });

  it('should handle all fingerprint types with various config values', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({
      canvas: { noiseLevel: 0 },
      webgl: { noiseLevel: 1 },
      audioContext: { frequencyOffset: 0 },
      cpu: { cores: 1 },
      ram: { sizeGB: 1 },
    });

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // canvas, webgl, audio, hardware, userAgent, fontList, webrtc(disable) = 7
    expect(mockContext.addInitScript).toHaveBeenCalledTimes(7);
    // All scripts should be non-empty strings
    for (const script of mockContext.calls) {
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    }
  });
});

import {
  generateUserAgentScript,
  generateFontListScript,
  generateWebRTCScript,
} from '../injection-scripts';

describe('FingerprintSpoofer.validateConsistency', () => {
  const spoofer = new FingerprintSpoofer();

  function makeFingerprint(configOverrides?: Partial<FingerprintConfig>): FingerprintData {
    const config = makeConfig(configOverrides);
    return spoofer.generateFingerprint(config);
  }

  it('should return valid for a consistent Windows fingerprint', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
      oscpu: 'Windows NT 10.0; Win64; x64',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return valid for a consistent Mac fingerprint', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      oscpu: 'Intel Mac OS X 10.15',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return valid for a consistent Linux fingerprint', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      platform: 'Linux',
      appVersion: '5.0 (X11; Linux x86_64)',
      oscpu: 'Linux x86_64',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect Windows UA with wrong platform', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'MacIntel',
      appVersion: '5.0 (Windows NT 10.0)',
      oscpu: 'Windows NT 10.0',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('platform'))).toBe(true);
  });

  it('should detect Windows UA with wrong oscpu', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      appVersion: '5.0 (Windows NT 10.0)',
      oscpu: 'Linux x86_64',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('oscpu'))).toBe(true);
  });

  it('should detect Mac UA with wrong platform', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'Win32',
      appVersion: '5.0 (Macintosh)',
      oscpu: 'Intel Mac OS X 10.15',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('platform'))).toBe(true);
  });

  it('should detect Mac UA with wrong oscpu', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      appVersion: '5.0 (Macintosh)',
      oscpu: 'Windows NT 10.0',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('oscpu'))).toBe(true);
  });

  it('should detect Linux UA with wrong platform', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      platform: 'Win32',
      appVersion: '5.0 (X11; Linux x86_64)',
      oscpu: 'Linux x86_64',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('platform'))).toBe(true);
  });

  it('should detect appVersion inconsistency with Mozilla/5.0 UA', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      appVersion: '4.0 (compatible)',
      oscpu: 'Windows NT 10.0',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('appVersion'))).toBe(true);
  });

  it('should collect multiple errors when multiple fields are inconsistent', () => {
    const fp = makeFingerprint({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Linux',
      appVersion: '4.0 (wrong)',
      oscpu: 'Mac OS X',
    });
    const result = spoofer.validateConsistency(fp);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('should not check appVersion if UA does not start with Mozilla/5.0', () => {
    const fp = makeFingerprint({
      userAgent: 'CustomBrowser/1.0',
      platform: 'Win32',
      appVersion: '1.0',
      oscpu: 'Windows NT 10.0',
    });
    const result = spoofer.validateConsistency(fp);
    // No OS-specific checks triggered, no appVersion check triggered
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});


describe('FingerprintSpoofer.applyFingerprint (with UA, fonts, WebRTC)', () => {
  const spoofer = new FingerprintSpoofer();

  function makeFingerprint(configOverrides?: Partial<FingerprintConfig>): FingerprintData {
    const config = makeConfig(configOverrides);
    return spoofer.generateFingerprint(config);
  }

  it('should call addInitScript 7 times when webrtc is disable', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ webrtc: 'disable' });

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // canvas, webgl, audio, hardware, userAgent, fontList, webrtc = 7
    expect(mockContext.addInitScript).toHaveBeenCalledTimes(7);
  });

  it('should call addInitScript 7 times when webrtc is proxy', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ webrtc: 'proxy' });

    await spoofer.applyFingerprint(mockContext, fingerprint);

    expect(mockContext.addInitScript).toHaveBeenCalledTimes(7);
  });

  it('should call addInitScript 6 times when webrtc is real (no WebRTC script)', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ webrtc: 'real' });

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // canvas, webgl, audio, hardware, userAgent, fontList = 6 (no webrtc)
    expect(mockContext.addInitScript).toHaveBeenCalledTimes(6);
  });

  it('should inject the User-Agent script with correct parameters', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({
      userAgent: 'TestUA/1.0',
      appVersion: '1.0',
      platform: 'Win32',
      oscpu: 'Windows NT 10.0',
    });

    const expectedScript = generateUserAgentScript(
      fingerprint.config.userAgent,
      fingerprint.config.appVersion,
      fingerprint.config.platform,
      fingerprint.config.oscpu,
    );

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // UA script is the 5th script (index 4)
    expect(mockContext.calls[4]).toBe(expectedScript);
  });

  it('should inject the font list script with correct fonts', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({
      fonts: ['Arial', 'Courier New'],
    });

    const expectedScript = generateFontListScript(fingerprint.config.fonts);

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // Font script is the 6th script (index 5)
    expect(mockContext.calls[5]).toBe(expectedScript);
  });

  it('should inject the WebRTC disable script when mode is disable', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ webrtc: 'disable' });

    const expectedScript = generateWebRTCScript('disable');

    await spoofer.applyFingerprint(mockContext, fingerprint);

    // WebRTC script is the 7th script (index 6)
    expect(mockContext.calls[6]).toBe(expectedScript);
  });

  it('should inject the WebRTC proxy script when mode is proxy', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ webrtc: 'proxy' });

    const expectedScript = generateWebRTCScript('proxy');

    await spoofer.applyFingerprint(mockContext, fingerprint);

    expect(mockContext.calls[6]).toBe(expectedScript);
  });

  it('should inject scripts in order: canvas, webgl, audio, hardware, userAgent, fontList, webrtc', async () => {
    const mockContext = createMockBrowserContext();
    const fingerprint = makeFingerprint({ webrtc: 'disable' });

    await spoofer.applyFingerprint(mockContext, fingerprint);

    expect(mockContext.calls[0]).toContain('HTMLCanvasElement');
    expect(mockContext.calls[1]).toContain('WebGLRenderingContext');
    expect(mockContext.calls[2]).toContain('AnalyserNode');
    expect(mockContext.calls[3]).toContain('hardwareConcurrency');
    expect(mockContext.calls[4]).toContain('userAgent');
    expect(mockContext.calls[5]).toContain('ALLOWED_FONTS');
    expect(mockContext.calls[6]).toContain('RTCPeerConnection');
  });
});
