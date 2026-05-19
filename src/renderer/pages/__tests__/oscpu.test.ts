import { describe, it, expect } from 'vitest';
import { getOscpu, OSType, BrowserType } from '../NewProfileForm';

describe('getOscpu', () => {
  describe('macOS 11+ with Firefox (dynamic oscpu)', () => {
    it('macOS 26 + Firefox → Intel Mac OS X 26.1', () => {
      expect(getOscpu('macos', 'macOS 26', 'firefox')).toBe('Intel Mac OS X 26.1');
    });

    it('macOS 15 + Firefox → Intel Mac OS X 15.1', () => {
      expect(getOscpu('macos', 'macOS 15', 'firefox')).toBe('Intel Mac OS X 15.1');
    });

    it('macOS 11 + Firefox → Intel Mac OS X 11.1', () => {
      expect(getOscpu('macos', 'macOS 11', 'firefox')).toBe('Intel Mac OS X 11.1');
    });
  });

  describe('macOS 10 with Firefox (legacy)', () => {
    it('macOS 10 + Firefox → Intel Mac OS X 10.15', () => {
      expect(getOscpu('macos', 'macOS 10', 'firefox')).toBe('Intel Mac OS X 10.15');
    });
  });

  describe('Windows with Firefox (preservation)', () => {
    it('Windows + Firefox → Windows NT 10.0; Win64; x64', () => {
      expect(getOscpu('windows', 'Windows 11', 'firefox')).toBe('Windows NT 10.0; Win64; x64');
    });
  });

  describe('Linux with Firefox (preservation)', () => {
    it('Linux + Firefox → Linux x86_64', () => {
      expect(getOscpu('linux', 'All Linux', 'firefox')).toBe('Linux x86_64');
    });
  });

  describe('Non-Firefox browsers return empty string', () => {
    it('macOS 26 + Chromium → empty string', () => {
      expect(getOscpu('macos', 'macOS 26', 'chromium')).toBe('');
    });

    it('Windows + Chromium → empty string', () => {
      expect(getOscpu('windows', 'Windows 11', 'chromium')).toBe('');
    });
  });
});
