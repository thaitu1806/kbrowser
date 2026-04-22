/**
 * Fingerprint Injection Scripts
 *
 * Functions that generate self-executing JavaScript code strings to be injected
 * into browser pages via page.addInitScript() or similar mechanisms.
 * Each script overrides browser APIs to spoof fingerprint values.
 */

/**
 * Generate a JavaScript injection script that adds deterministic noise to
 * Canvas rendering results (toDataURL and toBlob).
 *
 * @param seed - Deterministic seed for noise generation
 * @param noiseLevel - Noise intensity from 0 (none) to 1 (maximum)
 * @returns Self-executing JavaScript string
 */
export function generateCanvasNoiseScript(seed: string, noiseLevel: number): string {
  return `(function() {
  'use strict';
  const SEED = ${JSON.stringify(seed)};
  const NOISE_LEVEL = ${noiseLevel};

  // Simple seeded PRNG (mulberry32)
  function createRng(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return function() {
      h |= 0; h = h + 0x6D2B79F5 | 0;
      let t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function addNoiseToImageData(imageData, rng) {
    const data = imageData.data;
    const maxDelta = Math.ceil(NOISE_LEVEL * 10);
    for (let i = 0; i < data.length; i += 4) {
      // Modify RGB channels, leave alpha untouched
      data[i]     = Math.max(0, Math.min(255, data[i]     + Math.floor((rng() - 0.5) * 2 * maxDelta)));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + Math.floor((rng() - 0.5) * 2 * maxDelta)));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + Math.floor((rng() - 0.5) * 2 * maxDelta)));
    }
  }

  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const origToBlob = HTMLCanvasElement.prototype.toBlob;

  HTMLCanvasElement.prototype.toDataURL = function() {
    const ctx = this.getContext('2d');
    if (ctx && NOISE_LEVEL > 0) {
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      const rng = createRng(SEED);
      addNoiseToImageData(imageData, rng);
      ctx.putImageData(imageData, 0, 0);
    }
    return origToDataURL.apply(this, arguments);
  };

  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    const ctx = this.getContext('2d');
    if (ctx && NOISE_LEVEL > 0) {
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      const rng = createRng(SEED);
      addNoiseToImageData(imageData, rng);
      ctx.putImageData(imageData, 0, 0);
    }
    return origToBlob.call(this, callback, type, quality);
  };
})();`;
}

/**
 * Generate a JavaScript injection script that adds deterministic noise to
 * WebGL readPixels results.
 *
 * @param seed - Deterministic seed for noise generation
 * @param noiseLevel - Noise intensity from 0 (none) to 1 (maximum)
 * @returns Self-executing JavaScript string
 */
export function generateWebGLNoiseScript(seed: string, noiseLevel: number): string {
  return `(function() {
  'use strict';
  const SEED = ${JSON.stringify(seed)};
  const NOISE_LEVEL = ${noiseLevel};

  function createRng(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return function() {
      h |= 0; h = h + 0x6D2B79F5 | 0;
      let t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function patchReadPixels(proto) {
    const origReadPixels = proto.readPixels;
    proto.readPixels = function(x, y, width, height, format, type, pixels) {
      origReadPixels.call(this, x, y, width, height, format, type, pixels);
      if (pixels && NOISE_LEVEL > 0) {
        const rng = createRng(SEED);
        const maxDelta = Math.ceil(NOISE_LEVEL * 10);
        for (let i = 0; i < pixels.length; i++) {
          pixels[i] = Math.max(0, Math.min(255, pixels[i] + Math.floor((rng() - 0.5) * 2 * maxDelta)));
        }
      }
    };
  }

  if (typeof WebGLRenderingContext !== 'undefined') {
    patchReadPixels(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchReadPixels(WebGL2RenderingContext.prototype);
  }
})();`;
}

/**
 * Generate a JavaScript injection script that modifies AudioContext
 * frequency data output by a configured offset.
 *
 * @param seed - Deterministic seed for modification
 * @param frequencyOffset - Offset to apply to frequency data values
 * @returns Self-executing JavaScript string
 */
export function generateAudioNoiseScript(seed: string, frequencyOffset: number): string {
  return `(function() {
  'use strict';
  const SEED = ${JSON.stringify(seed)};
  const FREQUENCY_OFFSET = ${frequencyOffset};

  function createRng(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return function() {
      h |= 0; h = h + 0x6D2B79F5 | 0;
      let t = Math.imul(h ^ h >>> 15, 1 | h);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function patchAnalyserNode() {
    const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
    const origGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;

    AnalyserNode.prototype.getFloatFrequencyData = function(array) {
      origGetFloatFrequencyData.call(this, array);
      const rng = createRng(SEED);
      for (let i = 0; i < array.length; i++) {
        array[i] = array[i] + FREQUENCY_OFFSET + (rng() - 0.5) * 0.001;
      }
    };

    AnalyserNode.prototype.getByteFrequencyData = function(array) {
      origGetByteFrequencyData.call(this, array);
      const rng = createRng(SEED);
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.max(0, Math.min(255,
          Math.round(array[i] + FREQUENCY_OFFSET * 255 + (rng() - 0.5) * 0.5)
        ));
      }
    };
  }

  function patchAudioContext(OriginalContext, name) {
    if (typeof OriginalContext === 'undefined') return;

    const OrigProto = OriginalContext.prototype;
    const origCreateAnalyser = OrigProto.createAnalyser;

    OrigProto.createAnalyser = function() {
      const analyser = origCreateAnalyser.call(this);
      return analyser;
    };
  }

  if (typeof AnalyserNode !== 'undefined') {
    patchAnalyserNode();
  }

  if (typeof AudioContext !== 'undefined') {
    patchAudioContext(AudioContext, 'AudioContext');
  }
  if (typeof OfflineAudioContext !== 'undefined') {
    patchAudioContext(OfflineAudioContext, 'OfflineAudioContext');
  }
})();`;
}

/**
 * Generate a JavaScript injection script that spoofs navigator.hardwareConcurrency
 * and navigator.deviceMemory.
 *
 * @param cpuCores - Number of CPU cores to report (1-32)
 * @param ramGB - Amount of RAM in GB to report (1-64)
 * @returns Self-executing JavaScript string
 * @throws Error if cpuCores or ramGB are out of valid range
 */
export function generateHardwareScript(cpuCores: number, ramGB: number): string {
  if (cpuCores < 1 || cpuCores > 32) {
    throw new Error(`cpuCores must be in range [1, 32], got ${cpuCores}`);
  }
  if (ramGB < 1 || ramGB > 64) {
    throw new Error(`ramGB must be in range [1, 64], got ${ramGB}`);
  }

  return `(function() {
  'use strict';
  const CPU_CORES = ${cpuCores};
  const RAM_GB = ${ramGB};

  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: function() { return CPU_CORES; },
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(navigator, 'deviceMemory', {
    get: function() { return RAM_GB; },
    configurable: true,
    enumerable: true
  });
})();`;
}

/**
 * Generate a JavaScript injection script that spoofs navigator.userAgent,
 * navigator.appVersion, navigator.platform, and navigator.oscpu.
 *
 * @param userAgent - The User-Agent string to report
 * @param appVersion - The appVersion string to report
 * @param platform - The platform string to report (e.g., "Win32", "MacIntel", "Linux")
 * @param oscpu - The oscpu string to report
 * @returns Self-executing JavaScript string
 */
export function generateUserAgentScript(
  userAgent: string,
  appVersion: string,
  platform: string,
  oscpu: string,
): string {
  return `(function() {
  'use strict';
  const USER_AGENT = ${JSON.stringify(userAgent)};
  const APP_VERSION = ${JSON.stringify(appVersion)};
  const PLATFORM = ${JSON.stringify(platform)};
  const OSCPU = ${JSON.stringify(oscpu)};

  Object.defineProperty(navigator, 'userAgent', {
    get: function() { return USER_AGENT; },
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(navigator, 'appVersion', {
    get: function() { return APP_VERSION; },
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(navigator, 'platform', {
    get: function() { return PLATFORM; },
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(navigator, 'oscpu', {
    get: function() { return OSCPU; },
    configurable: true,
    enumerable: true
  });
})();`;
}

/**
 * Generate a JavaScript injection script that overrides document.fonts.check()
 * to only return true for fonts in the allowed list.
 *
 * @param fonts - Array of allowed font family names
 * @returns Self-executing JavaScript string
 */
export function generateFontListScript(fonts: string[]): string {
  return `(function() {
  'use strict';
  const ALLOWED_FONTS = ${JSON.stringify(fonts)};
  const allowedSet = new Set(ALLOWED_FONTS.map(function(f) { return f.toLowerCase(); }));

  if (typeof document !== 'undefined' && document.fonts) {
    const origCheck = document.fonts.check.bind(document.fonts);

    document.fonts.check = function(font, text) {
      // Extract font family from the CSS font shorthand (e.g., "12px Arial" -> "Arial")
      var parts = font.split(/\\s+/);
      // The font family is everything after the size (and optional style/weight)
      var family = '';
      for (var i = 0; i < parts.length; i++) {
        // Skip numeric parts (size like "12px", "1em") and common style/weight keywords
        if (/^[\\d.]/.test(parts[i]) || /^(normal|italic|oblique|bold|bolder|lighter|\\d{3})$/i.test(parts[i])) {
          continue;
        }
        family = parts.slice(i).join(' ').replace(/['"]/g, '');
        break;
      }

      if (!family) {
        return origCheck(font, text);
      }

      // Check if the font family is in the allowed list
      return allowedSet.has(family.toLowerCase());
    };
  }
})();`;
}

/**
 * Generate a JavaScript injection script for WebRTC spoofing.
 *
 * @param mode - 'disable' to block WebRTC entirely, 'proxy' to hide local IPs,
 *               'real' for no modification (returns empty string)
 * @returns Self-executing JavaScript string, or empty string for 'real' mode
 */
export function generateWebRTCScript(mode: 'disable' | 'proxy' | 'real'): string {
  if (mode === 'real') {
    return '';
  }

  if (mode === 'disable') {
    return `(function() {
  'use strict';

  // Override RTCPeerConnection to prevent WebRTC entirely
  if (typeof window !== 'undefined') {
    window.RTCPeerConnection = function() {
      throw new DOMException('RTCPeerConnection has been disabled', 'NotSupportedError');
    };
    window.RTCPeerConnection.prototype = {};

    // Also override the webkit-prefixed version
    if ('webkitRTCPeerConnection' in window) {
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
    }
  }
})();`;
  }

  // mode === 'proxy'
  return `(function() {
  'use strict';

  if (typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined') {
    var OriginalRTCPeerConnection = RTCPeerConnection;

    window.RTCPeerConnection = function(config) {
      // Force relay-only ICE transport to prevent local IP exposure
      config = config || {};
      config.iceTransportPolicy = 'relay';

      var pc = new OriginalRTCPeerConnection(config);

      // Wrap onicecandidate to filter out host candidates that expose local IPs
      var origAddEventListener = pc.addEventListener.bind(pc);
      pc.addEventListener = function(type, listener, options) {
        if (type === 'icecandidate') {
          var wrappedListener = function(event) {
            if (event.candidate && event.candidate.candidate) {
              // Filter out host candidates (typ host) which expose local IPs
              if (event.candidate.candidate.indexOf('typ host') !== -1) {
                return;
              }
            }
            listener.call(this, event);
          };
          return origAddEventListener(type, wrappedListener, options);
        }
        return origAddEventListener(type, listener, options);
      };

      return pc;
    };
    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;

    if ('webkitRTCPeerConnection' in window) {
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
    }
  }
})();`;
}
