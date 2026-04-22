import { describe, it, expect } from 'vitest';
import {
  BROWSER_TYPES,
  BROWSER_DISPLAY_NAMES,
  getBrowserDisplayName,
  getBrowserTypeFromDisplayName,
} from '../browser-types';
import type { BrowserType } from '../browser-types';

describe('browser-types constants', () => {
  it('BROWSER_TYPES contains chromium and firefox', () => {
    expect(BROWSER_TYPES).toContain('chromium');
    expect(BROWSER_TYPES).toContain('firefox');
    expect(BROWSER_TYPES).toHaveLength(2);
  });

  it('BROWSER_DISPLAY_NAMES maps chromium to SunBrowser', () => {
    expect(BROWSER_DISPLAY_NAMES.chromium).toBe('SunBrowser');
  });

  it('BROWSER_DISPLAY_NAMES maps firefox to FlowerBrowser', () => {
    expect(BROWSER_DISPLAY_NAMES.firefox).toBe('FlowerBrowser');
  });

  it('getBrowserDisplayName returns correct display names', () => {
    expect(getBrowserDisplayName('chromium')).toBe('SunBrowser');
    expect(getBrowserDisplayName('firefox')).toBe('FlowerBrowser');
  });

  it('getBrowserTypeFromDisplayName returns correct browser types', () => {
    expect(getBrowserTypeFromDisplayName('SunBrowser')).toBe('chromium');
    expect(getBrowserTypeFromDisplayName('FlowerBrowser')).toBe('firefox');
  });

  it('getBrowserTypeFromDisplayName returns undefined for unknown names', () => {
    expect(getBrowserTypeFromDisplayName('UnknownBrowser')).toBeUndefined();
    expect(getBrowserTypeFromDisplayName('')).toBeUndefined();
  });

  it('every BROWSER_TYPE has a display name mapping', () => {
    for (const browserType of BROWSER_TYPES) {
      const displayName = getBrowserDisplayName(browserType);
      expect(displayName).toBeDefined();
      expect(typeof displayName).toBe('string');
      expect(displayName.length).toBeGreaterThan(0);
    }
  });

  it('display name round-trip works for all browser types', () => {
    for (const browserType of BROWSER_TYPES) {
      const displayName = getBrowserDisplayName(browserType);
      const resolved = getBrowserTypeFromDisplayName(displayName);
      expect(resolved).toBe(browserType);
    }
  });
});
