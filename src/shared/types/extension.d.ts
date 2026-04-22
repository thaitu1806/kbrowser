/**
 * Extension Center types.
 * Types for managing browser extensions across profiles.
 */
/** A browser extension stored in the central repository. */
export interface Extension {
    id: string;
    name: string;
    version: string;
    source: 'upload' | 'store';
    assignedProfiles: string[];
}
//# sourceMappingURL=extension.d.ts.map