/**
 * Fingerprint Spoofer Service
 *
 * Tạo và áp dụng fingerprint giả lập cho mỗi hồ sơ trình duyệt:
 * Canvas noise, WebGL noise, AudioContext offset, CPU/RAM spoofing,
 * User-Agent, font list, WebRTC mode.
 */

export { FingerprintSpoofer } from './fingerprint-spoofer';
export {
  generateCanvasNoiseScript,
  generateWebGLNoiseScript,
  generateAudioNoiseScript,
  generateHardwareScript,
  generateUserAgentScript,
  generateFontListScript,
  generateWebRTCScript,
} from './injection-scripts';
