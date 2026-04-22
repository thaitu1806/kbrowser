/**
 * Profile Manager types.
 * Types for browser profile creation, management, and lifecycle.
 */
import type { FingerprintConfig } from './fingerprint';
import type { ProxyConfig } from './proxy';
/** Configuration used when creating or updating a browser profile. */
export interface ProfileConfig {
    name: string;
    browserType: 'chromium' | 'firefox';
    fingerprint: FingerprintConfig;
    proxy?: ProxyConfig;
    extensions?: string[];
}
/** Full profile entity with all metadata. */
export interface Profile {
    id: string;
    name: string;
    browserType: 'chromium' | 'firefox';
    ownerId: string;
    status: 'open' | 'closed';
    fingerprintConfig: FingerprintConfig;
    proxyId: string | null;
    syncEnabled: boolean;
    syncStatus: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
/** Summary view of a profile for list displays. */
export interface ProfileSummary {
    id: string;
    name: string;
    status: 'open' | 'closed';
    browserType: 'chromium' | 'firefox';
    proxyAssigned: string | null;
    lastUsedAt: string | null;
}
/** WebSocket connection info returned when opening a profile. */
export interface BrowserConnection {
    wsEndpoint: string;
    profileId: string;
}
//# sourceMappingURL=profile.d.ts.map