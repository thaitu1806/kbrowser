/**
 * IP Rotation Service
 *
 * Xoay vòng IP tự động qua tích hợp API Luminati và Oxylabs:
 * cấu hình khoảng thời gian xoay vòng, xác minh IP mới,
 * retry logic tối đa 3 lần.
 */

export { IPRotationService, defaultRotationProvider } from './ip-rotation';
export type { RotationProviderFn } from './ip-rotation';
