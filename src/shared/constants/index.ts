/**
 * Shared Constants
 *
 * Các hằng số dùng chung giữa main process và renderer process:
 * IPC channel names, error codes, default values, v.v.
 */

export {
  BROWSER_TYPES,
  BROWSER_DISPLAY_NAMES,
  getBrowserDisplayName,
  getBrowserTypeFromDisplayName,
} from './browser-types';
export type { BrowserType } from './browser-types';
