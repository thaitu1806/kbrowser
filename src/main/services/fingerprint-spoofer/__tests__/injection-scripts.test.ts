import { describe, it, expect } from 'vitest';
import {
  generateCanvasNoiseScript,
  generateWebGLNoiseScript,
  generateAudioNoiseScript,
  generateHardwareScript,
} from '../injection-scripts';

describe('generateCanvasNoiseScript', () => {
  it('should return a non-empty string', () => {
    const script = generateCanvasNoiseScript('test-seed', 0.5);
    expect(script).toBeTruthy();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('should contain the provided seed', () => {
    const seed = 'canvas-unique-seed-123';
    const script = generateCanvasNoiseScript(seed, 0.5);
    expect(script).toContain(seed);
  });

  it('should override toDataURL', () => {
    const script = generateCanvasNoiseScript('seed', 0.5);
    expect(script).toContain('HTMLCanvasElement.prototype.toDataURL');
  });

  it('should override toBlob', () => {
    const script = generateCanvasNoiseScript('seed', 0.5);
    expect(script).toContain('HTMLCanvasElement.prototype.toBlob');
  });

  it('should include the noise level value', () => {
    const script = generateCanvasNoiseScript('seed', 0.75);
    expect(script).toContain('0.75');
  });

  it('should be a self-executing function', () => {
    const script = generateCanvasNoiseScript('seed', 0.5);
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\}\)\(\);$/);
  });

  it('should use different seeds in the output for different inputs', () => {
    const script1 = generateCanvasNoiseScript('seed-a', 0.5);
    const script2 = generateCanvasNoiseScript('seed-b', 0.5);
    expect(script1).not.toBe(script2);
    expect(script1).toContain('seed-a');
    expect(script2).toContain('seed-b');
  });
});

describe('generateWebGLNoiseScript', () => {
  it('should return a non-empty string', () => {
    const script = generateWebGLNoiseScript('test-seed', 0.3);
    expect(script).toBeTruthy();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('should contain the provided seed', () => {
    const seed = 'webgl-unique-seed-456';
    const script = generateWebGLNoiseScript(seed, 0.3);
    expect(script).toContain(seed);
  });

  it('should override WebGLRenderingContext.prototype.readPixels', () => {
    const script = generateWebGLNoiseScript('seed', 0.3);
    expect(script).toContain('WebGLRenderingContext');
    expect(script).toContain('readPixels');
  });

  it('should also patch WebGL2RenderingContext', () => {
    const script = generateWebGLNoiseScript('seed', 0.3);
    expect(script).toContain('WebGL2RenderingContext');
  });

  it('should include the noise level value', () => {
    const script = generateWebGLNoiseScript('seed', 0.42);
    expect(script).toContain('0.42');
  });

  it('should be a self-executing function', () => {
    const script = generateWebGLNoiseScript('seed', 0.3);
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\}\)\(\);$/);
  });
});

describe('generateAudioNoiseScript', () => {
  it('should return a non-empty string', () => {
    const script = generateAudioNoiseScript('test-seed', 0.01);
    expect(script).toBeTruthy();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('should contain the provided seed', () => {
    const seed = 'audio-unique-seed-789';
    const script = generateAudioNoiseScript(seed, 0.01);
    expect(script).toContain(seed);
  });

  it('should reference AudioContext', () => {
    const script = generateAudioNoiseScript('seed', 0.01);
    expect(script).toContain('AudioContext');
  });

  it('should reference OfflineAudioContext', () => {
    const script = generateAudioNoiseScript('seed', 0.01);
    expect(script).toContain('OfflineAudioContext');
  });

  it('should include the frequency offset value', () => {
    const script = generateAudioNoiseScript('seed', 0.05);
    expect(script).toContain('0.05');
  });

  it('should patch AnalyserNode frequency data methods', () => {
    const script = generateAudioNoiseScript('seed', 0.01);
    expect(script).toContain('getFloatFrequencyData');
    expect(script).toContain('getByteFrequencyData');
  });

  it('should be a self-executing function', () => {
    const script = generateAudioNoiseScript('seed', 0.01);
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\}\)\(\);$/);
  });
});

describe('generateHardwareScript', () => {
  it('should return a non-empty string', () => {
    const script = generateHardwareScript(4, 8);
    expect(script).toBeTruthy();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('should include the correct CPU cores value', () => {
    const script = generateHardwareScript(16, 8);
    expect(script).toContain('const CPU_CORES = 16');
  });

  it('should include the correct RAM value', () => {
    const script = generateHardwareScript(4, 32);
    expect(script).toContain('const RAM_GB = 32');
  });

  it('should override navigator.hardwareConcurrency', () => {
    const script = generateHardwareScript(4, 8);
    expect(script).toContain('hardwareConcurrency');
  });

  it('should override navigator.deviceMemory', () => {
    const script = generateHardwareScript(4, 8);
    expect(script).toContain('deviceMemory');
  });

  it('should be a self-executing function', () => {
    const script = generateHardwareScript(4, 8);
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\}\)\(\);$/);
  });

  it('should accept boundary values: cpuCores=1, ramGB=1', () => {
    const script = generateHardwareScript(1, 1);
    expect(script).toContain('const CPU_CORES = 1');
    expect(script).toContain('const RAM_GB = 1');
  });

  it('should accept boundary values: cpuCores=32, ramGB=64', () => {
    const script = generateHardwareScript(32, 64);
    expect(script).toContain('const CPU_CORES = 32');
    expect(script).toContain('const RAM_GB = 64');
  });

  it('should throw for cpuCores below 1', () => {
    expect(() => generateHardwareScript(0, 8)).toThrow('cpuCores must be in range [1, 32]');
  });

  it('should throw for cpuCores above 32', () => {
    expect(() => generateHardwareScript(33, 8)).toThrow('cpuCores must be in range [1, 32]');
  });

  it('should throw for ramGB below 1', () => {
    expect(() => generateHardwareScript(4, 0)).toThrow('ramGB must be in range [1, 64]');
  });

  it('should throw for ramGB above 64', () => {
    expect(() => generateHardwareScript(4, 65)).toThrow('ramGB must be in range [1, 64]');
  });
});

import {
  generateUserAgentScript,
  generateFontListScript,
  generateWebRTCScript,
} from '../injection-scripts';

describe('generateUserAgentScript', () => {
  it('should return a non-empty self-executing function', () => {
    const script = generateUserAgentScript('Mozilla/5.0', '5.0', 'Win32', 'Windows NT 10.0');
    expect(script).toBeTruthy();
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\}\)\(\);$/);
  });

  it('should contain the provided userAgent value', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const script = generateUserAgentScript(ua, '5.0', 'Win32', 'Windows NT 10.0');
    expect(script).toContain(ua);
  });

  it('should contain the provided appVersion value', () => {
    const script = generateUserAgentScript('Mozilla/5.0', '5.0 (Windows)', 'Win32', 'Windows NT');
    expect(script).toContain('5.0 (Windows)');
  });

  it('should contain the provided platform value', () => {
    const script = generateUserAgentScript('Mozilla/5.0', '5.0', 'MacIntel', 'Intel Mac OS X');
    expect(script).toContain('MacIntel');
  });

  it('should contain the provided oscpu value', () => {
    const script = generateUserAgentScript('Mozilla/5.0', '5.0', 'Linux', 'Linux x86_64');
    expect(script).toContain('Linux x86_64');
  });

  it('should override navigator.userAgent via Object.defineProperty', () => {
    const script = generateUserAgentScript('UA', '5.0', 'Win32', 'Windows');
    expect(script).toContain("Object.defineProperty(navigator, 'userAgent'");
  });

  it('should override navigator.appVersion via Object.defineProperty', () => {
    const script = generateUserAgentScript('UA', '5.0', 'Win32', 'Windows');
    expect(script).toContain("Object.defineProperty(navigator, 'appVersion'");
  });

  it('should override navigator.platform via Object.defineProperty', () => {
    const script = generateUserAgentScript('UA', '5.0', 'Win32', 'Windows');
    expect(script).toContain("Object.defineProperty(navigator, 'platform'");
  });

  it('should override navigator.oscpu via Object.defineProperty', () => {
    const script = generateUserAgentScript('UA', '5.0', 'Win32', 'Windows');
    expect(script).toContain("Object.defineProperty(navigator, 'oscpu'");
  });

  it('should properly escape special characters in strings', () => {
    const ua = 'Mozilla/5.0 "special" chars';
    const script = generateUserAgentScript(ua, '5.0', 'Win32', 'Windows');
    // JSON.stringify handles escaping — the script should be valid JS
    expect(script).toContain('\\"special\\"');
  });
});

describe('generateFontListScript', () => {
  it('should return a non-empty self-executing function', () => {
    const script = generateFontListScript(['Arial', 'Verdana']);
    expect(script).toBeTruthy();
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\}\)\(\);$/);
  });

  it('should contain the allowed font names', () => {
    const fonts = ['Arial', 'Helvetica', 'Times New Roman'];
    const script = generateFontListScript(fonts);
    expect(script).toContain('Arial');
    expect(script).toContain('Helvetica');
    expect(script).toContain('Times New Roman');
  });

  it('should reference document.fonts.check', () => {
    const script = generateFontListScript(['Arial']);
    expect(script).toContain('document.fonts');
    expect(script).toContain('.check');
  });

  it('should handle an empty font list', () => {
    const script = generateFontListScript([]);
    expect(script).toBeTruthy();
    expect(script).toContain('ALLOWED_FONTS');
  });

  it('should create a case-insensitive set for font matching', () => {
    const script = generateFontListScript(['Arial']);
    expect(script).toContain('toLowerCase');
  });
});

describe('generateWebRTCScript', () => {
  describe('disable mode', () => {
    it('should return a non-empty self-executing function', () => {
      const script = generateWebRTCScript('disable');
      expect(script).toBeTruthy();
      expect(script).toMatch(/^\(function\(\)/);
      expect(script).toMatch(/\}\)\(\);$/);
    });

    it('should override RTCPeerConnection', () => {
      const script = generateWebRTCScript('disable');
      expect(script).toContain('RTCPeerConnection');
    });

    it('should throw when RTCPeerConnection is called', () => {
      const script = generateWebRTCScript('disable');
      expect(script).toContain('throw');
      expect(script).toContain('NotSupportedError');
    });

    it('should also handle webkitRTCPeerConnection', () => {
      const script = generateWebRTCScript('disable');
      expect(script).toContain('webkitRTCPeerConnection');
    });
  });

  describe('proxy mode', () => {
    it('should return a non-empty self-executing function', () => {
      const script = generateWebRTCScript('proxy');
      expect(script).toBeTruthy();
      expect(script).toMatch(/^\(function\(\)/);
      expect(script).toMatch(/\}\)\(\);$/);
    });

    it('should set iceTransportPolicy to relay', () => {
      const script = generateWebRTCScript('proxy');
      expect(script).toContain("iceTransportPolicy");
      expect(script).toContain("relay");
    });

    it('should filter out host ICE candidates', () => {
      const script = generateWebRTCScript('proxy');
      expect(script).toContain('typ host');
    });

    it('should preserve the original RTCPeerConnection prototype', () => {
      const script = generateWebRTCScript('proxy');
      expect(script).toContain('OriginalRTCPeerConnection.prototype');
    });

    it('should also handle webkitRTCPeerConnection', () => {
      const script = generateWebRTCScript('proxy');
      expect(script).toContain('webkitRTCPeerConnection');
    });
  });

  describe('real mode', () => {
    it('should return an empty string', () => {
      const script = generateWebRTCScript('real');
      expect(script).toBe('');
    });
  });
});
