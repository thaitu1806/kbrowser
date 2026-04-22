/**
 * Cloud Sync Service
 *
 * Đồng bộ dữ liệu hồ sơ giữa các máy tính qua PostgreSQL cloud:
 * mã hóa dữ liệu, phát hiện xung đột, resume sync từ checkpoint.
 */

export { CloudSync } from './cloud-sync';
export type { CloudStorageAdapter } from './cloud-sync';
