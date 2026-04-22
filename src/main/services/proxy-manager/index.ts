/**
 * Proxy Manager Service
 *
 * Quản lý cấu hình proxy (HTTP, HTTPS, SOCKS5),
 * kiểm tra trạng thái proxy, gán proxy cho hồ sơ trình duyệt.
 */

export { ProxyManager, defaultProxyChecker } from './proxy-manager';
export type { ProxyCheckerFn, ProxyValidationResult, PlaywrightProxyConfig } from './proxy-manager';
