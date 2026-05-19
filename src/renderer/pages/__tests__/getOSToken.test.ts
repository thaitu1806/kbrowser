import { describe, it, expect } from 'vitest';
import { getOSToken, OSType } from '../NewProfileForm';

describe('getOSToken', () => {
  describe('macOS 11+ (new format)', () => {
    it('macOS 26 → Macintosh; Intel Mac OS X 26_1_0', () => {
      expect(getOSToken('macos', 'macOS 26')).toBe('Macintosh; Intel Mac OS X 26_1_0');
    });

    it('macOS 15 → Macintosh; Intel Mac OS X 15_1_0', () => {
      expect(getOSToken('macos', 'macOS 15')).toBe('Macintosh; Intel Mac OS X 15_1_0');
    });

    it('macOS 11 → Macintosh; Intel Mac OS X 11_1_0', () => {
      expect(getOSToken('macos', 'macOS 11')).toBe('Macintosh; Intel Mac OS X 11_1_0');
    });
  });

  describe('macOS 10 (legacy format)', () => {
    it('macOS 10 → Macintosh; Intel Mac OS X 10_15_7', () => {
      expect(getOSToken('macos', 'macOS 10')).toBe('Macintosh; Intel Mac OS X 10_15_7');
    });
  });

  describe('Windows (preservation)', () => {
    it('Windows 11 → Windows NT 10.0; Win64; x64', () => {
      expect(getOSToken('windows', 'Windows 11')).toBe('Windows NT 10.0; Win64; x64');
    });

    it('Windows 10 → Windows NT 10.0; Win64; x64', () => {
      expect(getOSToken('windows', 'Windows 10')).toBe('Windows NT 10.0; Win64; x64');
    });

    it('Windows 8 → Windows NT 6.3; Win64; x64', () => {
      expect(getOSToken('windows', 'Windows 8')).toBe('Windows NT 6.3; Win64; x64');
    });

    it('Windows 7 → Windows NT 6.1; Win64; x64', () => {
      expect(getOSToken('windows', 'Windows 7')).toBe('Windows NT 6.1; Win64; x64');
    });
  });

  describe('Linux (preservation)', () => {
    it('Linux → X11; Linux x86_64', () => {
      expect(getOSToken('linux', 'All Linux')).toBe('X11; Linux x86_64');
    });
  });

  describe('Android (preservation)', () => {
    it('Android 14 → Linux; Android 14; Pixel 8', () => {
      expect(getOSToken('android', 'Android 14')).toBe('Linux; Android 14; Pixel 8');
    });
  });

  describe('iOS (preservation)', () => {
    it('iOS 18 → iPhone; CPU iPhone OS 18_0 like Mac OS X', () => {
      expect(getOSToken('ios', 'iOS 18')).toBe('iPhone; CPU iPhone OS 18_0 like Mac OS X');
    });
  });

  describe('macOS default (All macOS)', () => {
    it('All macOS → uses default version 15 → Macintosh; Intel Mac OS X 15_1_0', () => {
      expect(getOSToken('macos', 'All macOS')).toBe('Macintosh; Intel Mac OS X 15_1_0');
    });
  });
});
