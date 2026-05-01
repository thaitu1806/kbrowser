import { useState } from 'react';
import type { FingerprintConfig } from '@shared/types';

const DEFAULT_FONTS = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Trebuchet MS', 'Comic Sans MS'];

const defaultConfig: FingerprintConfig = {
  canvas: { noiseLevel: 0.5 },
  webgl: { noiseLevel: 0.5 },
  audioContext: { frequencyOffset: 0.01 },
  cpu: { cores: 4 },
  ram: { sizeGB: 8 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  fonts: ['Arial', 'Helvetica', 'Times New Roman'],
  webrtc: 'proxy',
  platform: 'Win32',
  appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
  oscpu: 'Windows NT 10.0; Win64; x64',
  timezone: 'America/New_York',
  locale: 'en-US',
  screen: { width: 1920, height: 1080, colorDepth: 24 },
};

interface FingerprintConfigFormProps {
  profileId?: string;
  initialConfig?: FingerprintConfig;
  onSave?: (config: FingerprintConfig) => void;
  onCancel?: () => void;
}

export default function FingerprintConfigForm({ profileId, initialConfig, onSave, onCancel }: FingerprintConfigFormProps) {
  const [config, setConfig] = useState<FingerprintConfig>(initialConfig ?? defaultConfig);

  const handleSave = () => {
    // TODO: IPC call — window.electronAPI.updateFingerprintConfig(profileId, config)
    onSave?.(config);
  };

  const toggleFont = (font: string) => {
    setConfig((prev) => ({
      ...prev,
      fonts: prev.fonts.includes(font) ? prev.fonts.filter((f) => f !== font) : [...prev.fonts, font],
    }));
  };

  return (
    <div className="page">
      <h2>Cấu hình Fingerprint {profileId ? `— ${profileId}` : ''}</h2>

      {/* Canvas & WebGL */}
      <div className="section">
        <h3>Canvas & WebGL</h3>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="canvas-noise">Canvas Noise Level ({config.canvas.noiseLevel.toFixed(2)})</label>
            <input
              id="canvas-noise"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.canvas.noiseLevel}
              onChange={(e) => setConfig({ ...config, canvas: { noiseLevel: parseFloat(e.target.value) } })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="webgl-noise">WebGL Noise Level ({config.webgl.noiseLevel.toFixed(2)})</label>
            <input
              id="webgl-noise"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.webgl.noiseLevel}
              onChange={(e) => setConfig({ ...config, webgl: { noiseLevel: parseFloat(e.target.value) } })}
            />
          </div>
        </div>
      </div>

      {/* AudioContext */}
      <div className="section">
        <h3>AudioContext</h3>
        <div className="form-group">
          <label htmlFor="audio-offset">Frequency Offset ({config.audioContext.frequencyOffset.toFixed(4)})</label>
          <input
            id="audio-offset"
            type="range"
            min="0"
            max="0.1"
            step="0.001"
            value={config.audioContext.frequencyOffset}
            onChange={(e) => setConfig({ ...config, audioContext: { frequencyOffset: parseFloat(e.target.value) } })}
          />
        </div>
      </div>

      {/* Hardware */}
      <div className="section">
        <h3>Phần cứng ảo</h3>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="cpu-cores">CPU Cores (1–32)</label>
            <input
              id="cpu-cores"
              type="number"
              min={1}
              max={32}
              value={config.cpu.cores}
              onChange={(e) => setConfig({ ...config, cpu: { cores: Math.min(32, Math.max(1, parseInt(e.target.value) || 1)) } })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="ram-size">RAM (1–64 GB)</label>
            <input
              id="ram-size"
              type="number"
              min={1}
              max={64}
              value={config.ram.sizeGB}
              onChange={(e) => setConfig({ ...config, ram: { sizeGB: Math.min(64, Math.max(1, parseInt(e.target.value) || 1)) } })}
            />
          </div>
        </div>
      </div>

      {/* Screen Resolution */}
      <div className="section">
        <h3>Màn hình</h3>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="screen-res">Độ phân giải</label>
            <select
              id="screen-res"
              value={`${config.screen.width}x${config.screen.height}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split('x').map(Number);
                setConfig({ ...config, screen: { ...config.screen, width: w, height: h } });
              }}
            >
              <option value="1366x768">1366×768 (HD)</option>
              <option value="1440x900">1440×900</option>
              <option value="1536x864">1536×864</option>
              <option value="1600x900">1600×900 (HD+)</option>
              <option value="1920x1080">1920×1080 (Full HD)</option>
              <option value="2560x1440">2560×1440 (2K)</option>
              <option value="3840x2160">3840×2160 (4K)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="color-depth">Color Depth</label>
            <select
              id="color-depth"
              value={config.screen.colorDepth}
              onChange={(e) => setConfig({ ...config, screen: { ...config.screen, colorDepth: parseInt(e.target.value) } })}
            >
              <option value="24">24-bit (phổ biến)</option>
              <option value="32">32-bit</option>
            </select>
          </div>
        </div>
      </div>

      {/* User-Agent & Platform */}
      <div className="section">
        <h3>User-Agent & Platform</h3>
        <div className="form-group">
          <label htmlFor="user-agent">User-Agent</label>
          <input
            id="user-agent"
            value={config.userAgent}
            onChange={(e) => setConfig({ ...config, userAgent: e.target.value })}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="platform">Platform</label>
            <input
              id="platform"
              value={config.platform}
              onChange={(e) => setConfig({ ...config, platform: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="oscpu">OS/CPU</label>
            <input
              id="oscpu"
              value={config.oscpu}
              onChange={(e) => setConfig({ ...config, oscpu: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="app-version">App Version</label>
          <input
            id="app-version"
            value={config.appVersion}
            onChange={(e) => setConfig({ ...config, appVersion: e.target.value })}
          />
        </div>
      </div>

      {/* Timezone & Locale */}
      <div className="section">
        <h3>Timezone & Ngôn ngữ</h3>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="timezone">Timezone (IANA)</label>
            <select
              id="timezone"
              value={config.timezone}
              onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
            >
              <option value="America/New_York">America/New_York (UTC-5)</option>
              <option value="America/Chicago">America/Chicago (UTC-6)</option>
              <option value="America/Denver">America/Denver (UTC-7)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (UTC-8)</option>
              <option value="America/Anchorage">America/Anchorage (UTC-9)</option>
              <option value="Pacific/Honolulu">Pacific/Honolulu (UTC-10)</option>
              <option value="Europe/London">Europe/London (UTC+0)</option>
              <option value="Europe/Paris">Europe/Paris (UTC+1)</option>
              <option value="Europe/Berlin">Europe/Berlin (UTC+1)</option>
              <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
              <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
              <option value="Asia/Kolkata">Asia/Kolkata (UTC+5:30)</option>
              <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
              <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
              <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
              <option value="Australia/Sydney">Australia/Sydney (UTC+10)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="locale">Locale</label>
            <select
              id="locale"
              value={config.locale}
              onChange={(e) => setConfig({ ...config, locale: e.target.value })}
            >
              <option value="en-US">en-US (English - US)</option>
              <option value="en-GB">en-GB (English - UK)</option>
              <option value="fr-FR">fr-FR (French)</option>
              <option value="de-DE">de-DE (German)</option>
              <option value="es-ES">es-ES (Spanish)</option>
              <option value="pt-BR">pt-BR (Portuguese - Brazil)</option>
              <option value="ru-RU">ru-RU (Russian)</option>
              <option value="ja-JP">ja-JP (Japanese)</option>
              <option value="ko-KR">ko-KR (Korean)</option>
              <option value="zh-CN">zh-CN (Chinese - Simplified)</option>
              <option value="zh-TW">zh-TW (Chinese - Traditional)</option>
              <option value="vi-VN">vi-VN (Vietnamese)</option>
              <option value="th-TH">th-TH (Thai)</option>
              <option value="ar-SA">ar-SA (Arabic)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Fonts */}
      <div className="section">
        <h3>Danh sách Font</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {DEFAULT_FONTS.map((font) => (
            <label key={font} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.fonts.includes(font)}
                onChange={() => toggleFont(font)}
              />
              {font}
            </label>
          ))}
        </div>
      </div>

      {/* WebRTC */}
      <div className="section">
        <h3>WebRTC</h3>
        <div className="form-group">
          <label htmlFor="webrtc-mode">Chế độ WebRTC</label>
          <select
            id="webrtc-mode"
            value={config.webrtc}
            onChange={(e) => setConfig({ ...config, webrtc: e.target.value as 'disable' | 'proxy' | 'real' })}
          >
            <option value="disable">Vô hiệu hóa (Disable)</option>
            <option value="proxy">Qua Proxy</option>
            <option value="real">Thực (Real)</option>
          </select>
        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSave}>Lưu cấu hình</button>
        {onCancel && <button className="btn" onClick={onCancel}>Hủy</button>}
      </div>
    </div>
  );
}
