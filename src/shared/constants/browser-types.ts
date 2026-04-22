/**
 * Browser type constants and display name mappings.
 *
 * Internal browser types ('chromium' | 'firefox') map to user-facing
 * display names: SunBrowser (Chromium) and FlowerBrowser (Firefox).
 */

/** Internal browser type identifiers used throughout the codebase. */
export type BrowserType = 'chromium' | 'firefox';

/** All supported browser types. */
export const BROWSER_TYPES: readonly BrowserType[] = ['chromium', 'firefox'] as const;

/** Maps internal browser type to its user-facing display name. */
export const BROWSER_DISPLAY_NAMES: Record<BrowserType, string> = {
  chromium: 'SunBrowser',
  firefox: 'FlowerBrowser',
} as const;

/**
 * Returns the display name for a given browser type.
 *
 * @param browserType - Internal browser type identifier
 * @returns User-facing display name (e.g. 'SunBrowser' or 'FlowerBrowser')
 */
export function getBrowserDisplayName(browserType: BrowserType): string {
  return BROWSER_DISPLAY_NAMES[browserType];
}

/**
 * Returns the internal browser type for a given display name, or undefined
 * if the display name is not recognized.
 *
 * @param displayName - User-facing display name (e.g. 'SunBrowser')
 * @returns Internal browser type or undefined
 */
export function getBrowserTypeFromDisplayName(displayName: string): BrowserType | undefined {
  const entry = Object.entries(BROWSER_DISPLAY_NAMES).find(
    ([, name]) => name === displayName,
  );
  return entry ? (entry[0] as BrowserType) : undefined;
}
