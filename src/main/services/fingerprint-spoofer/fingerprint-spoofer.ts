/**
 * Fingerprint Spoofer Service
 *
 * Generates and manages browser fingerprint data for each profile.
 * Seeds are generated deterministically based on config values combined
 * with a random component to ensure uniqueness per config instance.
 */

import { randomUUID } from 'crypto';
import type { FingerprintConfig, FingerprintData, ValidationResult } from '@shared/types';
import {
  generateCanvasNoiseScript,
  generateWebGLNoiseScript,
  generateAudioNoiseScript,
  generateHardwareScript,
  generateUserAgentScript,
  generateFontListScript,
  generateWebRTCScript,
  generateTimezoneLocaleScript,
  generateScreenScript,
} from './injection-scripts';

/** Minimal interface for a Playwright BrowserContext used by applyFingerprint. */
export interface BrowserContext {
  addInitScript(script: string | { content: string }): Promise<void>;
}

export class FingerprintSpoofer {
  /**
   * Generate fingerprint data from a FingerprintConfig.
   *
   * Each seed is derived from the relevant config value combined with
   * a random UUID component to ensure uniqueness across different
   * generateFingerprint() calls, even for identical configs.
   *
   * @param config - The fingerprint configuration for a browser profile
   * @returns FingerprintData containing the config and generated seeds
   */
  generateFingerprint(config: FingerprintConfig): FingerprintData {
    const canvasSeed = `canvas-${config.canvas.noiseLevel}-${randomUUID()}`;
    const webglSeed = `webgl-${config.webgl.noiseLevel}-${randomUUID()}`;
    const audioSeed = `audio-${config.audioContext.frequencyOffset}-${randomUUID()}`;

    return {
      config,
      canvasSeed,
      webglSeed,
      audioSeed,
    };
  }

  /**
   * Validate consistency between User-Agent, platform, appVersion, and oscpu.
   *
   * Checks that the navigator properties are consistent with the User-Agent
   * string. For example, a Windows UA should have platform "Win32" and oscpu
   * containing "Windows".
   *
   * @param fingerprint - The fingerprint data to validate
   * @returns ValidationResult with isValid flag and any error messages
   */
  validateConsistency(fingerprint: FingerprintData): ValidationResult {
    const errors: string[] = [];
    const { userAgent, platform, appVersion, oscpu } = fingerprint.config;

    // Check Windows consistency
    if (userAgent.includes('Windows')) {
      if (platform !== 'Win32') {
        errors.push(`UA contains "Windows" but platform is "${platform}" (expected "Win32")`);
      }
      if (!oscpu.includes('Windows')) {
        errors.push(`UA contains "Windows" but oscpu "${oscpu}" does not contain "Windows"`);
      }
    }

    // Check Mac consistency
    if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS')) {
      if (platform !== 'MacIntel') {
        errors.push(`UA contains Mac identifier but platform is "${platform}" (expected "MacIntel")`);
      }
      if (!oscpu.includes('Mac') && !oscpu.includes('Intel')) {
        errors.push(`UA contains Mac identifier but oscpu "${oscpu}" does not contain "Mac" or "Intel"`);
      }
    }

    // Check Linux consistency
    if (userAgent.includes('Linux')) {
      if (platform !== 'Linux') {
        errors.push(`UA contains "Linux" but platform is "${platform}" (expected "Linux")`);
      }
      if (!oscpu.includes('Linux')) {
        errors.push(`UA contains "Linux" but oscpu "${oscpu}" does not contain "Linux"`);
      }
    }

    // Check appVersion consistency with UA
    if (userAgent.startsWith('Mozilla/5.0')) {
      if (!appVersion.startsWith('5.0')) {
        errors.push(`UA starts with "Mozilla/5.0" but appVersion "${appVersion}" does not start with "5.0"`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply fingerprint spoofing scripts to a Playwright BrowserContext.
   *
   * Generates injection scripts for Canvas noise, WebGL noise, AudioContext
   * frequency offset, hardware (CPU/RAM) spoofing, User-Agent, font list,
   * and WebRTC mode, then injects each into the browser context via
   * addInitScript().
   *
   * @param browser - A Playwright BrowserContext instance
   * @param fingerprint - The generated fingerprint data to apply
   */
  async applyFingerprint(browser: BrowserContext, fingerprint: FingerprintData): Promise<void> {
    const canvasScript = generateCanvasNoiseScript(
      fingerprint.canvasSeed,
      fingerprint.config.canvas.noiseLevel,
    );

    const webglScript = generateWebGLNoiseScript(
      fingerprint.webglSeed,
      fingerprint.config.webgl.noiseLevel,
    );

    const audioScript = generateAudioNoiseScript(
      fingerprint.audioSeed,
      fingerprint.config.audioContext.frequencyOffset,
    );

    const hardwareScript = generateHardwareScript(
      fingerprint.config.cpu.cores,
      fingerprint.config.ram.sizeGB,
    );

    const userAgentScript = generateUserAgentScript(
      fingerprint.config.userAgent,
      fingerprint.config.appVersion,
      fingerprint.config.platform,
      fingerprint.config.oscpu,
    );

    const fontListScript = generateFontListScript(fingerprint.config.fonts);

    const webrtcScript = generateWebRTCScript(fingerprint.config.webrtc);

    // Generate timezone/locale injection script if configured
    const timezoneLocaleScript = fingerprint.config.timezone && fingerprint.config.locale
      ? generateTimezoneLocaleScript(fingerprint.config.timezone, fingerprint.config.locale)
      : '';

    await browser.addInitScript(canvasScript);
    await browser.addInitScript(webglScript);
    await browser.addInitScript(audioScript);
    await browser.addInitScript(hardwareScript);
    await browser.addInitScript(userAgentScript);
    await browser.addInitScript(fontListScript);

    // Only inject WebRTC script if it's non-empty (mode !== 'real')
    if (webrtcScript.length > 0) {
      await browser.addInitScript(webrtcScript);
    }

    // Inject timezone/locale spoofing
    if (timezoneLocaleScript.length > 0) {
      await browser.addInitScript(timezoneLocaleScript);
    }

    // Inject screen resolution spoofing
    if (fingerprint.config.screen) {
      const screenScript = generateScreenScript(
        fingerprint.config.screen.width,
        fingerprint.config.screen.height,
        fingerprint.config.screen.colorDepth,
      );
      await browser.addInitScript(screenScript);
    }
  }
}
