/**
 * Proxy Manager types.
 * Types for proxy configuration, checking, and IP rotation.
 */
/** Configuration for a proxy server. */
export interface ProxyConfig {
    protocol: 'http' | 'https' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
}
/** Full proxy entity stored in the database. */
export interface Proxy {
    id: string;
    protocol: 'http' | 'https' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
    status: 'alive' | 'dead' | null;
    responseTimeMs: number | null;
    lastCheckedAt: string | null;
}
/** Result of a proxy health check. */
export interface ProxyCheckResult {
    status: 'alive' | 'dead';
    responseTimeMs: number;
    checkedAt: string;
}
/** Configuration for automatic IP rotation. */
export interface RotationConfig {
    enabled: boolean;
    intervalSeconds: number;
    provider: 'luminati' | 'oxylabs';
    apiKey: string;
}
/** Result of an IP rotation attempt. */
export interface RotationResult {
    success: boolean;
    newIP?: string;
    attempts: number;
    error?: string;
}
//# sourceMappingURL=proxy.d.ts.map