/**
 * useAPI hook — provides access to the Electron IPC API.
 * Falls back gracefully when running outside Electron (e.g., in a browser via Vite dev).
 */

const api = typeof window !== 'undefined' && window.electronAPI ? window.electronAPI : null;

/** Returns true if running inside Electron with IPC available. */
export function isElectron(): boolean {
  return api !== null;
}

/** Returns the electronAPI or null if not available. */
export function getAPI() {
  return api;
}

export default function useAPI() {
  return {
    isElectron: api !== null,
    api,
  };
}
