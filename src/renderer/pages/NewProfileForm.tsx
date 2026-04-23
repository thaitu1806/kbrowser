import { useState, useEffect, useRef, useCallback } from 'react';
import type { FingerprintConfig, ProxyConfig } from '@shared/types';

type TabId = 'general' | 'proxy' | 'platform' | 'fingerprint' | 'advanced';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'platform', label: 'Platform' },
  { id: 'fingerprint', label: 'Fingerprint' },
  { id: 'advanced', label: 'Advanced' },
];

type BrowserType = 'chromium' | 'firefox';
type OSType = 'windows' | 'macos' | 'linux' | 'android' | 'ios';
type WebRTCMode = 'forward' | 'replace' | 'real' | 'disabled' | 'disable-udp';
type ProxyType = 'none' | 'http' | 'https' | 'socks5';

const BROWSER_VERSIONS: Record<BrowserType, string[]> = {
  chromium: ['Auto', 'Chrome 146', 'Chrome 145', 'Chrome 144', 'Chrome 143', 'Chrome 142', 'Chrome 141', 'Chrome 140'],
  firefox: ['Auto', 'Firefox 147', 'Firefox 144', 'Firefox 141', 'Firefox 138', 'Firefox 135', 'Firefox 132', 'Firefox 129'],
};

const OS_VERSIONS: Record<OSType, string[]> = {
  windows: ['All Windows', 'Windows 11', 'Windows 10', 'Windows 8', 'Windows 7'],
  macos: ['All macOS', 'macOS 26', 'macOS 15', 'macOS 14', 'macOS 13', 'macOS 12', 'macOS 11', 'macOS 10'],
  linux: ['All Linux', 'Ubuntu 24', 'Ubuntu 22', 'Ubuntu 20', 'Debian 12', 'Debian 11', 'Fedora 40', 'Fedora 39'],
  android: ['All Android', 'Android 15', 'Android 14', 'Android 13', 'Android 12', 'Android 11', 'Android 10', 'Android 9'],
  ios: ['All iOS', 'iOS 26', 'iOS 18', 'iOS 17', 'iOS 16', 'iOS 15', 'iOS 14', 'iOS 13'],
};

const OS_META: { id: OSType; icon: string; label: string }[] = [
  { id: 'windows', icon: '🪟', label: 'Win' },
  { id: 'macos', icon: '🍎', label: 'Mac' },
  { id: 'linux', icon: '🐧', label: 'Linux' },
  { id: 'android', icon: '🤖', label: 'Android' },
  { id: 'ios', icon: '📱', label: 'iOS' },
];

/** Maps OS + version to the OS token used in User-Agent strings. */
function getOSToken(os: OSType, version: string): string {
  switch (os) {
    case 'windows': {
      if (version === 'Windows 11') return 'Windows NT 10.0; Win64; x64';
      if (version === 'Windows 10') return 'Windows NT 10.0; Win64; x64';
      if (version === 'Windows 8') return 'Windows NT 6.3; Win64; x64';
      if (version === 'Windows 7') return 'Windows NT 6.1; Win64; x64';
      return 'Windows NT 10.0; Win64; x64';
    }
    case 'macos': {
      const ver = version.match(/\d+/)?.[0] ?? '15';
      return `Macintosh; Intel Mac OS X 10_${ver}_7`;
    }
    case 'linux':
      return 'X11; Linux x86_64';
    case 'android': {
      const ver = version.match(/\d+/)?.[0] ?? '14';
      return `Linux; Android ${ver}; Pixel 8`;
    }
    case 'ios': {
      const ver = version.match(/\d+/)?.[0] ?? '17';
      return `iPhone; CPU iPhone OS ${ver}_0 like Mac OS X`;
    }
  }
}

/** Generates a User-Agent string based on browser, version, and OS. */
function generateUserAgent(browser: BrowserType, browserVer: string, os: OSType, osVer: string): string {
  const osToken = getOSToken(os, osVer);
  const chromeVer = browserVer === 'Auto' ? '146.0.7680.80' : `${browserVer.replace('Chrome ', '')}.0.0.0`;
  const firefoxVer = browserVer === 'Auto' ? '147.0' : `${browserVer.replace('Firefox ', '')}.0`;

  if (browser === 'chromium') {
    if (os === 'android') {
      return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Mobile Safari/537.36`;
    }
    if (os === 'ios') {
      return `Mozilla/5.0 (${osToken}) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${chromeVer} Mobile/15E148 Safari/604.1`;
    }
    return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  }
  // firefox
  if (os === 'android') {
    return `Mozilla/5.0 (${osToken}; rv:${firefoxVer}) Gecko/${firefoxVer} Firefox/${firefoxVer}`;
  }
  if (os === 'ios') {
    return `Mozilla/5.0 (${osToken}) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/${firefoxVer} Mobile/15E148 Safari/605.1.15`;
  }
  return `Mozilla/5.0 (${osToken}; rv:${firefoxVer}) Gecko/20100101 Firefox/${firefoxVer}`;
}

/** UA version list for the dropdown (derived from browser versions). */
function getUAVersions(browser: BrowserType): string[] {
  return BROWSER_VERSIONS[browser].map((v) => {
    if (v === 'Auto') return v;
    const num = v.match(/\d+/)?.[0] ?? '';
    return `UA ${num}`;
  });
}

interface ProfileFormData {
  name: string;
  browser: BrowserType;
  browserVersion: string;
  os: OSType;
  osVersion: string;
  userAgent: string;
  group: string;
  tags: string[];
  cookie: string;
  remark: string;
  // Proxy
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  proxyUser: string;
  proxyPass: string;
  ipChecker: string;
  // Platform
  platformAccounts: string[];
  tabs: string;
  // Fingerprint
  webrtc: WebRTCMode;
  timezone: 'based-on-ip' | 'real' | 'custom';
  location: 'based-on-ip' | 'custom' | 'block';
  locationAsk: boolean;
  language: 'based-on-ip' | 'real' | 'custom';
  displayLanguage: 'based-on-language' | 'real' | 'custom';
  screenResolution: 'based-on-ua' | 'real' | 'custom';
  fonts: 'default' | 'custom';
  canvasNoise: boolean;
  webglNoise: boolean;
  audioNoise: boolean;
  mediaDevice: boolean;
  clientRects: boolean;
  speechVoices: boolean;
  webglMeta: 'real' | 'custom';
  webglVendor: string;
  webglRenderer: string;
  webgpu: 'based-on-webgl' | 'real' | 'disabled';
  // Advanced
  cpuMode: 'real' | 'custom';
  cpuCores: number;
  ramMode: 'real' | 'custom';
  ramSize: number;
  deviceNameMode: 'real' | 'custom';
  deviceName: string;
  macAddressMode: 'real' | 'custom';
  macAddress: string;
  doNotTrack: 'default' | 'open' | 'close';
  // Advanced tab
  extensionMode: string;
  dataSync: 'global' | 'custom';
  browserSettings: 'global' | 'custom';
  randomFingerprint: boolean;
}

const defaultForm: ProfileFormData = {
  name: '',
  browser: 'chromium',
  browserVersion: 'Auto',
  os: 'windows',
  osVersion: 'All Windows',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.159 Safari/537.36',
  group: 'Ungrouped',
  tags: [],
  cookie: '',
  remark: '',
  proxyType: 'none',
  proxyHost: '',
  proxyPort: '',
  proxyUser: '',
  proxyPass: '',
  ipChecker: 'IP2Location',
  platformAccounts: [],
  tabs: '',
  webrtc: 'disabled',
  timezone: 'based-on-ip',
  location: 'based-on-ip',
  locationAsk: true,
  language: 'based-on-ip',
  displayLanguage: 'based-on-language',
  screenResolution: 'based-on-ua',
  fonts: 'default',
  canvasNoise: false,
  webglNoise: false,
  audioNoise: true,
  mediaDevice: true,
  clientRects: true,
  speechVoices: true,
  webglMeta: 'custom',
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce 9600 GT (0...',
  webgpu: 'based-on-webgl',
  cpuMode: 'custom',
  cpuCores: 12,
  ramMode: 'custom',
  ramSize: 8,
  deviceNameMode: 'custom',
  deviceName: 'DESKTOP-C7MR8JF',
  macAddressMode: 'custom',
  macAddress: '00-1F-3A-19-B0-02',
  doNotTrack: 'default',
  extensionMode: 'team',
  dataSync: 'global',
  browserSettings: 'global',
  randomFingerprint: false,
};

interface NewProfileFormProps {
  editProfileId?: string | null;
  onSave?: (data: ProfileFormData) => void;
  onCancel?: () => void;
}

export default function NewProfileForm({ editProfileId, onSave, onCancel }: NewProfileFormProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [form, setForm] = useState<ProfileFormData>(defaultForm);
  const [proxyCheckResult, setProxyCheckResult] = useState<{ status: string; message: string } | null>(null);
  const [proxyChecking, setProxyChecking] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<TabId, HTMLDivElement | null>>({
    general: null, proxy: null, platform: null, fingerprint: null, advanced: null,
  });

  // Scroll to section when tab is clicked
  const scrollToSection = useCallback((tabId: TabId) => {
    const el = sectionRefs.current[tabId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setActiveTab(tabId);
  }, []);

  // Update active tab based on scroll position
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleScroll = () => {
      const scrollTop = container.scrollTop + 60;
      let current: TabId = 'general';
      for (const tab of TABS) {
        const el = sectionRefs.current[tab.id];
        if (el && el.offsetTop <= scrollTop) {
          current = tab.id;
        }
      }
      setActiveTab(current);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Load profile data when editing
  useEffect(() => {
    if (!editProfileId) { setIsEdit(false); return; }
    setIsEdit(true);
    const loadProfile = async () => {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (!api) return;
      const profile = await api.getProfile(editProfileId);
      if (!profile) return;
      const fp = profile.fingerprintConfig;
      // proxyConfig is returned by the IPC handler alongside the profile
      const profileData = profile as Record<string, unknown>;
      const proxy = profileData.proxyConfig as {
        protocol: string; host: string; port: number; username?: string; password?: string;
      } | null | undefined;
      setForm((prev) => ({
        ...prev,
        name: profile.name,
        browser: profile.browserType === 'firefox' ? 'firefox' : 'chromium',
        browserVersion: 'Auto',
        os: fp?.platform === 'MacIntel' ? 'macos' : fp?.platform === 'Linux' ? 'linux' : 'windows',
        osVersion: fp?.platform === 'MacIntel' ? 'All macOS' : fp?.platform === 'Linux' ? 'All Linux' : 'All Windows',
        userAgent: fp?.userAgent || prev.userAgent,
        canvasNoise: fp ? fp.canvas.noiseLevel > 0 : false,
        webglNoise: fp ? fp.webgl.noiseLevel > 0 : false,
        audioNoise: fp ? fp.audioContext.frequencyOffset > 0 : true,
        cpuCores: fp?.cpu.cores || 4,
        ramSize: fp?.ram.sizeGB || 8,
        webrtc: fp?.webrtc === 'disable' ? 'disabled' : fp?.webrtc === 'proxy' ? 'forward' : 'real',
        proxyType: proxy?.protocol ? proxy.protocol as ProxyType : 'none',
        proxyHost: proxy?.host || '',
        proxyPort: proxy?.port ? String(proxy.port) : '',
        proxyUser: proxy?.username || '',
        proxyPass: proxy?.password || '',
      }));
      // Load cookies
      try {
        const cookieData = await api.getProfileCookies(editProfileId);
        if (cookieData) {
          setForm((prev) => ({ ...prev, cookie: cookieData }));
        }
      } catch { /* ignore */ }
    };
    loadProfile();
  }, [editProfileId]);

  const update = <K extends keyof ProfileFormData>(key: K, value: ProfileFormData[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-regenerate UA when browser, browserVersion, os, or osVersion changes
      if (key === 'browser' || key === 'browserVersion' || key === 'os' || key === 'osVersion') {
        next.userAgent = generateUserAgent(next.browser, next.browserVersion, next.os, next.osVersion);
      }
      return next;
    });
  };

  const handleRandomUA = () => {
    const versions = BROWSER_VERSIONS[form.browser].filter((v) => v !== 'Auto');
    const randomVer = versions[Math.floor(Math.random() * versions.length)];
    update('browserVersion', randomVer);
  };

  const uaVersions = getUAVersions(form.browser);

  const handleCheckProxy = async () => {
    if (form.proxyType === 'none' || !form.proxyHost || !form.proxyPort) {
      setProxyCheckResult({ status: 'error', message: 'Please fill in proxy host and port first.' });
      return;
    }
    setProxyChecking(true);
    setProxyCheckResult(null);
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (api) {
        const result = await api.checkProxyDirect({
          protocol: form.proxyType as 'http' | 'https' | 'socks5',
          host: form.proxyHost,
          port: parseInt(form.proxyPort) || 0,
          username: form.proxyUser || undefined,
          password: form.proxyPass || undefined,
        }, form.ipChecker);
        if (result.success) {
          const lines = ['Connection test passed!'];
          if (result.ip) lines.push(`IP: ${result.ip}`);
          if (result.country) lines.push(`Country/Region: ${result.country}`);
          if (result.region) lines.push(`Region: ${result.region}`);
          if (result.city) lines.push(`City: ${result.city}`);
          lines.push(`Response: ${result.responseTimeMs}ms`);
          setProxyCheckResult({ status: 'success', message: lines.join('\n') });
        } else {
          setProxyCheckResult({
            status: 'error',
            message: `Connection failed!\n${result.error || 'Proxy unreachable'}\nResponse: ${result.responseTimeMs}ms`,
          });
        }
      } else {
        // Demo mode
        await new Promise((r) => setTimeout(r, 1500));
        setProxyCheckResult({
          status: 'success',
          message: `Connection test passed!\nIP: 2601:645:c68a:bd0:a4b1:8c2a:7997:3f3f\nCountry/Region: US\nRegion: California\nCity: Boulder Creek\nResponse: ${Math.floor(Math.random() * 200 + 50)}ms`,
        });
      }
    } catch (err: unknown) {
      setProxyCheckResult({
        status: 'error',
        message: `Check failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    } finally {
      setProxyChecking(false);
    }
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    setSaving(true);
    try {
      // Check proxy before saving if proxy is configured
      if (form.proxyType !== 'none' && form.proxyHost && form.proxyPort && api) {
        setProxyCheckResult(null);
        const result = await api.checkProxyDirect({
          protocol: form.proxyType as 'http' | 'https' | 'socks5',
          host: form.proxyHost,
          port: parseInt(form.proxyPort) || 0,
          username: form.proxyUser || undefined,
          password: form.proxyPass || undefined,
        });
        if (!result.success) {
          setProxyCheckResult({
            status: 'error',
            message: `❌ Proxy is dead! Cannot save.\n${result.error || 'Connection failed'}\nPlease fix the proxy or choose "No Proxy".`,
          });
          setSaving(false);
          // Scroll to proxy section
          scrollToSection('proxy');
          return;
        }
      }

      const config = {
        name: form.name || `Profile ${Date.now()}`,
        browserType: form.browser === 'firefox' ? 'firefox' as const : 'chromium' as const,
        fingerprint: {
          canvas: { noiseLevel: form.canvasNoise ? 0.5 : 0 },
          webgl: { noiseLevel: form.webglNoise ? 0.5 : 0 },
          audioContext: { frequencyOffset: form.audioNoise ? 0.01 : 0 },
          cpu: { cores: form.cpuCores },
          ram: { sizeGB: form.ramSize },
          userAgent: form.userAgent,
          fonts: ['Arial', 'Helvetica', 'Times New Roman'],
          webrtc: form.webrtc === 'disabled' ? 'disable' as const : form.webrtc === 'forward' ? 'proxy' as const : 'real' as const,
          platform: form.os === 'windows' ? 'Win32' : form.os === 'macos' ? 'MacIntel' : 'Linux',
          appVersion: form.userAgent.replace('Mozilla/', ''),
          oscpu: form.os === 'windows' ? 'Windows NT 10.0; Win64; x64' : form.os === 'macos' ? 'Intel Mac OS X 10.15' : 'Linux x86_64',
        },
        proxy: form.proxyType !== 'none' ? {
          protocol: form.proxyType as 'http' | 'https' | 'socks5',
          host: form.proxyHost,
          port: parseInt(form.proxyPort) || 0,
          username: form.proxyUser || undefined,
          password: form.proxyPass || undefined,
        } : undefined,
      };

      if (api) {
        if (isEdit && editProfileId) {
          await api.updateProfile(editProfileId, config);
          // Also update proxy if changed
          if (config.proxy && config.proxy.host) {
            const proxy = await api.addProxy(config.proxy);
            await api.assignProxy(proxy.id, editProfileId);
          }
        } else {
          const profile = await api.createProfile(config);
          // Assign proxy if configured
          if (config.proxy && config.proxy.host) {
            const proxy = await api.addProxy(config.proxy);
            await api.assignProxy(proxy.id, profile.id);
          }
        }
      }
      onSave?.(form);
    } catch (err: unknown) {
      alert(`Failed to ${isEdit ? 'update' : 'create'} profile: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="npf">
      {/* Tabs — sticky at top */}
      <div className="npf-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`npf-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => scrollToSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content — all sections visible, scrollable */}
      <div className="npf-content" ref={contentRef}>

        {/* ═══ GENERAL ═══ */}
        <div className="npf-section" ref={(el) => { sectionRefs.current.general = el; }} id="section-general">
            <FormRow label="Name">
              <input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Optional: profile name"
                maxLength={100}
              />
              <span className="char-count">{form.name.length} / 100</span>
            </FormRow>

            <FormRow label="Browser">
              <div className="toggle-group">
                <BrowserButton
                  type="chromium"
                  label="SunBrowser"
                  icon="🌐"
                  active={form.browser === 'chromium'}
                  version={form.browser === 'chromium' ? form.browserVersion : 'Auto'}
                  versions={BROWSER_VERSIONS.chromium}
                  onSelect={() => { update('browser', 'chromium'); update('browserVersion', 'Auto'); }}
                  onVersionChange={(ver) => { update('browser', 'chromium'); update('browserVersion', ver); }}
                />
                <BrowserButton
                  type="firefox"
                  label="FlowerBrowser"
                  icon="🦊"
                  active={form.browser === 'firefox'}
                  version={form.browser === 'firefox' ? form.browserVersion : 'Auto'}
                  versions={BROWSER_VERSIONS.firefox}
                  onSelect={() => { update('browser', 'firefox'); update('browserVersion', 'Auto'); }}
                  onVersionChange={(ver) => { update('browser', 'firefox'); update('browserVersion', ver); }}
                />
              </div>
            </FormRow>

            <FormRow label="OS">
              <div className="toggle-group">
                {OS_META.map((os) => (
                  <OsButton
                    key={os.id}
                    os={os}
                    active={form.os === os.id}
                    version={form.os === os.id ? form.osVersion : OS_VERSIONS[os.id][0]}
                    versions={OS_VERSIONS[os.id]}
                    onSelect={(osId) => {
                      update('os', osId);
                      update('osVersion', OS_VERSIONS[osId][0]);
                    }}
                    onVersionChange={(ver) => update('osVersion', ver)}
                  />
                ))}
              </div>
            </FormRow>

            <FormRow label="User-Agent">
              <div className="ua-row">
                <div className="ua-select-wrapper">
                  <select
                    className="ua-select"
                    value={(() => {
                      if (form.browserVersion === 'Auto') return 'All';
                      const num = form.browserVersion.match(/\d+/)?.[0] ?? '';
                      return `UA ${num}`;
                    })()}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'All' || val === 'Auto') {
                        update('browserVersion', 'Auto');
                      } else {
                        const num = val.replace('UA ', '');
                        const prefix = form.browser === 'chromium' ? 'Chrome' : 'Firefox';
                        update('browserVersion', `${prefix} ${num}`);
                      }
                    }}
                  >
                    <option value="All">All</option>
                    {uaVersions.filter((v) => v !== 'Auto').map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <input
                  value={form.userAgent}
                  onChange={(e) => setForm((prev) => ({ ...prev, userAgent: e.target.value }))}
                  className="ua-input"
                />
                <button className="icon-btn" title="Save">💾</button>
                <button className="icon-btn" title="Random" onClick={handleRandomUA}>🔀</button>
              </div>
            </FormRow>

            <FormRow label="* Group">
              <div className="group-tags-row">
                <select
                  value={form.group}
                  onChange={(e) => update('group', e.target.value)}
                  className="group-select-field"
                >
                  <option>Ungrouped</option>
                  <option>Group 1</option>
                  <option>Group 2</option>
                </select>
                <button className="tags-btn">🏷️ Tags</button>
              </div>
            </FormRow>

            <FormRow label="Cookie">
              <input
                value={form.cookie}
                onChange={(e) => update('cookie', e.target.value)}
                placeholder="Formats: JSON, Netscape, Name=Value"
              />
              <div className="merge-cookie">⊕ Merge cookie</div>
            </FormRow>

            <FormRow label="Remark">
              <textarea
                value={form.remark}
                onChange={(e) => update('remark', e.target.value)}
                placeholder="Enter remark"
                rows={3}
                maxLength={1500}
              />
              <span className="char-count">{form.remark.length} / 1500</span>
            </FormRow>
          </div>

        {/* ═══ PROXY ═══ */}
        <div className="npf-section" ref={(el) => { sectionRefs.current.proxy = el; }} id="section-proxy">
            <div className="npf-two-col">
              <div className="npf-col-main">
                <div className="section-label">Proxy</div>
                <div className="proxy-tabs">
                  <button className="proxy-tab">Custom</button>
                  <button className="proxy-tab">Saved Proxies</button>
                  <button className="proxy-tab">Proxy Provider</button>
                  <button className="proxy-tab outline">🛒 Buy Proxy</button>
                </div>

                <FormRow label="Proxy type">
                  <select
                    value={form.proxyType}
                    onChange={(e) => update('proxyType', e.target.value as ProxyType)}
                  >
                    <option value="none">No Proxy (Local network)</option>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                  {form.proxyType !== 'none' && (
                    <button
                      className={`check-network-btn ${proxyChecking ? 'checking' : ''}`}
                      onClick={handleCheckProxy}
                      disabled={proxyChecking}
                    >
                      {proxyChecking ? '⏳ Checking...' : 'Check the network'}
                    </button>
                  )}
                  {proxyCheckResult && (
                    <div className={`proxy-check-result ${proxyCheckResult.status}`}>
                      {proxyCheckResult.message}
                    </div>
                  )}
                </FormRow>

                {form.proxyType !== 'none' && (
                  <>
                    <FormRow label="Host">
                      <input
                        value={form.proxyHost}
                        onChange={(e) => update('proxyHost', e.target.value)}
                        placeholder="Proxy host"
                      />
                    </FormRow>
                    <FormRow label="Port">
                      <input
                        value={form.proxyPort}
                        onChange={(e) => update('proxyPort', e.target.value)}
                        placeholder="Proxy port"
                      />
                    </FormRow>
                    <FormRow label="Username">
                      <input
                        value={form.proxyUser}
                        onChange={(e) => update('proxyUser', e.target.value)}
                        placeholder="Optional"
                      />
                    </FormRow>
                    <FormRow label="Password">
                      <input
                        type="password"
                        value={form.proxyPass}
                        onChange={(e) => update('proxyPass', e.target.value)}
                        placeholder="Optional"
                      />
                    </FormRow>
                  </>
                )}

                <FormRow label="IP checker">
                  <select value={form.ipChecker} onChange={(e) => update('ipChecker', e.target.value)}>
                    <option>IP2Location</option>
                    <option>ipinfo.io</option>
                    <option>ip-api.com</option>
                  </select>
                </FormRow>

                <div className="section-divider" />
                <div className="section-label">Platform</div>

                <FormRow label="Platform">
                  <button className="add-platform-btn">⊕ Add Platform Account</button>
                </FormRow>

                <FormRow label="Tabs">
                  <textarea
                    value={form.tabs}
                    onChange={(e) => update('tabs', e.target.value)}
                    placeholder={'Enter URLs (one URL per line)\nwww.google.com\nwww.facebook.com'}
                    rows={3}
                  />
                </FormRow>
              </div>

              {/* Overview Panel */}
              <div className="npf-col-overview">
                <div className="overview-header">
                  <span className="overview-title">Overview</span>
                  <button className="new-fp-btn">🔄 New fingerprint</button>
                </div>
                <div className="overview-table">
                  <OverviewRow label="Browser" value={`${form.browser === 'chromium' ? 'SunBrowser' : 'FlowerBrowser'} [${form.browserVersion}]`} />
                  <OverviewRow label="User-Agent" value={form.userAgent} />
                  <OverviewRow label="WebRTC" value={form.webrtc === 'disabled' ? 'Disabled' : form.webrtc} />
                  <OverviewRow label="Timezone" value="Based on IP" />
                  <OverviewRow label="Location" value="[Ask] Based on IP" />
                  <OverviewRow label="Language" value="Based on IP" />
                  <OverviewRow label="Display language" value="Based on Language" />
                  <OverviewRow label="Screen Resolution" value="Based on User-Agent" />
                </div>
                <div className="overview-footer">
                  Set default values in <a href="#">Preferences</a>.
                </div>
              </div>
            </div>
          </div>

        {/* ═══ PLATFORM ═══ */}
        <div className="npf-section" ref={(el) => { sectionRefs.current.platform = el; }} id="section-platform">
            <div className="section-label">Platform</div>
            <FormRow label="Platform">
              <button className="add-platform-btn">⊕ Add Platform Account</button>
            </FormRow>
            <FormRow label="Tabs">
              <textarea
                value={form.tabs}
                onChange={(e) => update('tabs', e.target.value)}
                placeholder={'Enter URLs (one URL per line)\nwww.google.com\nwww.facebook.com'}
                rows={4}
              />
            </FormRow>

            <div className="section-divider" />
            <div className="section-label">Fingerprint</div>

            <FormRow label="WebRTC">
              <div className="toggle-group">
                {(['forward', 'replace', 'real', 'disabled', 'disable-udp'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`toggle-btn ${form.webrtc === mode ? 'active' : ''}`}
                    onClick={() => update('webrtc', mode)}
                  >
                    {mode === 'disabled' ? 'Disabled' : mode === 'disable-udp' ? 'Disable UDP' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </FormRow>

            <FormRow label="Timezone">
              <div className="toggle-group">
                {(['based-on-ip', 'real', 'custom'] as const).map((v) => (
                  <button
                    key={v}
                    className={`toggle-btn ${form.timezone === v ? 'active' : ''}`}
                    onClick={() => update('timezone', v)}
                  >
                    {v === 'based-on-ip' ? 'Based on IP' : v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </FormRow>

            <FormRow label="Location">
              <div className="toggle-group">
                {(['based-on-ip', 'custom', 'block'] as const).map((v) => (
                  <button
                    key={v}
                    className={`toggle-btn ${form.location === v ? 'active' : ''}`}
                    onClick={() => update('location', v)}
                  >
                    {v === 'based-on-ip' ? 'Based on IP' : v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
              <div className="radio-row">
                <label className="radio-label">
                  <input type="radio" checked={form.locationAsk} onChange={() => update('locationAsk', true)} />
                  Ask each time
                </label>
                <label className="radio-label">
                  <input type="radio" checked={!form.locationAsk} onChange={() => update('locationAsk', false)} />
                  Always allow
                </label>
              </div>
            </FormRow>
          </div>

        {/* ═══ FINGERPRINT ═══ */}
        <div className="npf-section" ref={(el) => { sectionRefs.current.fingerprint = el; }} id="section-fingerprint">
            <FormRow label="Fonts">
              <div className="toggle-group">
                <button className={`toggle-btn ${form.fonts === 'default' ? 'active' : ''}`} onClick={() => update('fonts', 'default')}>Default</button>
                <button className={`toggle-btn ${form.fonts === 'custom' ? 'active' : ''}`} onClick={() => update('fonts', 'custom')}>Custom</button>
              </div>
            </FormRow>

            <FormRow label="Hardware noise">
              <div className="switch-row">
                <SwitchToggle label="Canvas" checked={form.canvasNoise} onChange={(v) => update('canvasNoise', v)} />
                <SwitchToggle label="WebGL Image" checked={form.webglNoise} onChange={(v) => update('webglNoise', v)} />
                <SwitchToggle label="AudioContext" checked={form.audioNoise} onChange={(v) => update('audioNoise', v)} />
                <SwitchToggle label="Media device [Auto]" checked={form.mediaDevice} onChange={(v) => update('mediaDevice', v)} />
                <span className="edit-link">Edit</span>
              </div>
              <div className="switch-row" style={{ marginTop: 8 }}>
                <SwitchToggle label="ClientRects" checked={form.clientRects} onChange={(v) => update('clientRects', v)} />
                <SwitchToggle label="SpeechVoices" checked={form.speechVoices} onChange={(v) => update('speechVoices', v)} />
              </div>
            </FormRow>

            <FormRow label="WebGL metadata">
              <div className="toggle-group" style={{ marginBottom: 12 }}>
                <button className={`toggle-btn ${form.webglMeta === 'real' ? 'active' : ''}`} onClick={() => update('webglMeta', 'real')}>Real</button>
                <button className={`toggle-btn ${form.webglMeta === 'custom' ? 'active' : ''}`} onClick={() => update('webglMeta', 'custom')}>Custom</button>
              </div>
              {form.webglMeta === 'custom' && (
                <div className="webgl-custom-fields">
                  <div className="sub-field">
                    <label>Vendor</label>
                    <select value={form.webglVendor} onChange={(e) => update('webglVendor', e.target.value)}>
                      <option>Google Inc. (NVIDIA)</option>
                      <option>Google Inc. (AMD)</option>
                      <option>Google Inc. (Intel)</option>
                    </select>
                  </div>
                  <div className="sub-field">
                    <label>Renderer</label>
                    <div className="renderer-row">
                      <input value={form.webglRenderer} onChange={(e) => update('webglRenderer', e.target.value)} />
                      <button className="icon-btn" title="Random">🔀</button>
                    </div>
                  </div>
                </div>
              )}
            </FormRow>

            <FormRow label="WebGPU">
              <div className="toggle-group">
                <button className={`toggle-btn ${form.webgpu === 'based-on-webgl' ? 'active' : ''}`} onClick={() => update('webgpu', 'based-on-webgl')}>Based on WebGL</button>
                <button className={`toggle-btn ${form.webgpu === 'real' ? 'active' : ''}`} onClick={() => update('webgpu', 'real')}>Real</button>
                <button className={`toggle-btn ${form.webgpu === 'disabled' ? 'active' : ''}`} onClick={() => update('webgpu', 'disabled')}>Disabled</button>
              </div>
            </FormRow>

            <ShowMoreSection form={form} update={update} />
          </div>

        {/* ═══ ADVANCED ═══ */}
        <div className="npf-section" ref={(el) => { sectionRefs.current.advanced = el; }} id="section-advanced">
            <div className="section-label">Advanced</div>

            <FormRow label="Extension">
              <select
                value={form.extensionMode}
                onChange={(e) => update('extensionMode', e.target.value)}
              >
                <option value="team">Use team&apos;s extensions</option>
                <option value="none">No extensions</option>
                <option value="custom">Custom</option>
              </select>
              <div className="field-hint">
                The enabled extensions from [Extensions - Team&apos;s Extensions] will be installed in the profile.
              </div>
            </FormRow>

            <FormRow label="Data Sync">
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${form.dataSync === 'global' ? 'active' : ''}`}
                  onClick={() => update('dataSync', 'global')}
                >
                  Use global settings
                </button>
                <button
                  className={`toggle-btn ${form.dataSync === 'custom' ? 'active' : ''}`}
                  onClick={() => update('dataSync', 'custom')}
                >
                  Customize
                </button>
              </div>
            </FormRow>

            <FormRow label="Browser Settings">
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${form.browserSettings === 'global' ? 'active' : ''}`}
                  onClick={() => update('browserSettings', 'global')}
                >
                  Use global settings
                </button>
                <button
                  className={`toggle-btn ${form.browserSettings === 'custom' ? 'active' : ''}`}
                  onClick={() => update('browserSettings', 'custom')}
                >
                  Customize
                </button>
              </div>
            </FormRow>

            <FormRow label="Random fingerprint">
              <div className="random-fp-row">
                <SwitchToggle
                  label=""
                  checked={form.randomFingerprint}
                  onChange={(v) => update('randomFingerprint', v)}
                />
                <span className="field-hint-inline">
                  Enabled: New fingerprint will be randomly generated on each startup, ignoring some existing settings.
                </span>
              </div>
            </FormRow>
          </div>

      </div>

      {/* Footer */}
      <div className="npf-footer">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '⏳ Checking proxy...' : (isEdit ? 'Save Changes' : 'Create Profile')}
        </button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function ShowMoreSection({ form, update }: { form: ProfileFormData; update: <K extends keyof ProfileFormData>(key: K, value: ProfileFormData[K]) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <button className="show-more-btn" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less ▴' : 'Show more ▾'}
      </button>
      {expanded && (
        <>
          <FormRow label="CPU">
            <div className="toggle-group" style={{ marginBottom: 8 }}>
              <button className={`toggle-btn ${form.cpuMode === 'real' ? 'active' : ''}`} onClick={() => update('cpuMode', 'real')}>Real</button>
              <button className={`toggle-btn ${form.cpuMode === 'custom' ? 'active' : ''}`} onClick={() => update('cpuMode', 'custom')}>Custom</button>
            </div>
            {form.cpuMode === 'custom' && (
              <select value={form.cpuCores} onChange={(e) => update('cpuCores', parseInt(e.target.value))}>
                {[1, 2, 4, 6, 8, 12, 16, 24, 32].map((n) => (
                  <option key={n} value={n}>{n} cores</option>
                ))}
              </select>
            )}
          </FormRow>

          <FormRow label="RAM">
            <div className="toggle-group" style={{ marginBottom: 8 }}>
              <button className={`toggle-btn ${form.ramMode === 'real' ? 'active' : ''}`} onClick={() => update('ramMode', 'real')}>Real</button>
              <button className={`toggle-btn ${form.ramMode === 'custom' ? 'active' : ''}`} onClick={() => update('ramMode', 'custom')}>Custom</button>
            </div>
            {form.ramMode === 'custom' && (
              <select value={form.ramSize} onChange={(e) => update('ramSize', parseInt(e.target.value))}>
                {[1, 2, 4, 8, 16, 32, 64].map((n) => (
                  <option key={n} value={n}>{n} GB</option>
                ))}
              </select>
            )}
          </FormRow>

          <FormRow label="Device name">
            <div className="toggle-group" style={{ marginBottom: 8 }}>
              <button className={`toggle-btn ${form.deviceNameMode === 'real' ? 'active' : ''}`} onClick={() => update('deviceNameMode', 'real')}>Real</button>
              <button className={`toggle-btn ${form.deviceNameMode === 'custom' ? 'active' : ''}`} onClick={() => update('deviceNameMode', 'custom')}>Custom</button>
            </div>
            {form.deviceNameMode === 'custom' && (
              <div className="renderer-row">
                <input value={form.deviceName} onChange={(e) => update('deviceName', e.target.value)} />
                <button className="icon-btn" title="Random" onClick={() => update('deviceName', `DESKTOP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`)}>🔀</button>
              </div>
            )}
          </FormRow>

          <FormRow label="MAC Address">
            <div className="toggle-group" style={{ marginBottom: 8 }}>
              <button className={`toggle-btn ${form.macAddressMode === 'real' ? 'active' : ''}`} onClick={() => update('macAddressMode', 'real')}>Real</button>
              <button className={`toggle-btn ${form.macAddressMode === 'custom' ? 'active' : ''}`} onClick={() => update('macAddressMode', 'custom')}>Custom</button>
            </div>
            {form.macAddressMode === 'custom' && (
              <div className="renderer-row">
                <input value={form.macAddress} onChange={(e) => update('macAddress', e.target.value)} />
                <button className="icon-btn" title="Random" onClick={() => {
                  const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
                  update('macAddress', `${hex()}-${hex()}-${hex()}-${hex()}-${hex()}-${hex()}`);
                }}>🔀</button>
              </div>
            )}
          </FormRow>

          <FormRow label="Do Not Track">
            <div className="toggle-group">
              <button className={`toggle-btn ${form.doNotTrack === 'default' ? 'active' : ''}`} onClick={() => update('doNotTrack', 'default')}>Default</button>
              <button className={`toggle-btn ${form.doNotTrack === 'open' ? 'active' : ''}`} onClick={() => update('doNotTrack', 'open')}>Open</button>
              <button className={`toggle-btn ${form.doNotTrack === 'close' ? 'active' : ''}`} onClick={() => update('doNotTrack', 'close')}>Close</button>
            </div>
          </FormRow>
        </>
      )}
    </>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="npf-form-row">
      <label className="npf-label">{label}</label>
      <div className="npf-field">{children}</div>
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="overview-row">
      <span className="overview-key">{label}</span>
      <span className="overview-val">{value}</span>
    </div>
  );
}

function SwitchToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-label">
      <div className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <div className="switch-thumb" />
      </div>
      <span>{label}</span>
    </label>
  );
}

function BrowserButton({
  type,
  label,
  icon,
  active,
  version,
  versions,
  onSelect,
  onVersionChange,
}: {
  type: BrowserType;
  label: string;
  icon: string;
  active: boolean;
  version: string;
  versions: string[];
  onSelect: () => void;
  onVersionChange: (ver: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="browser-dropdown-wrapper">
      <div className={`browser-btn-group ${active ? 'active' : ''}`}>
        <button className="browser-btn-main" onClick={onSelect}>
          <span className="browser-icon">{icon}</span>
          <span className="browser-label">{label}</span>
        </button>
        <button
          className="browser-btn-arrow"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          {open ? '∧' : '∨'}
        </button>
      </div>
      {open && (
        <>
          <div className="os-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="os-dropdown browser-dropdown">
            {versions.map((ver) => (
              <button
                key={ver}
                className={`os-dropdown-item ${version === ver ? 'selected' : ''}`}
                onClick={() => { onVersionChange(ver); setOpen(false); }}
              >
                <span>{ver}</span>
                {ver === 'Auto' ? null : <span className="browser-dl-icon">⬇</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OsButton({
  os,
  active,
  version,
  versions,
  onSelect,
  onVersionChange,
}: {
  os: { id: OSType; icon: string; label: string };
  active: boolean;
  version: string;
  versions: string[];
  onSelect: (osId: OSType) => void;
  onVersionChange: (ver: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="os-dropdown-wrapper">
      <div className={`os-btn-group ${active ? 'active' : ''}`}>
        <button
          className="os-btn-main"
          onClick={() => onSelect(os.id)}
          title={os.label}
        >
          {active && <span className="os-check">✓</span>}
          <span className="os-icon">{os.icon}</span>
        </button>
        <button
          className="os-btn-arrow"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          {open ? '∧' : '∨'}
        </button>
      </div>
      {open && (
        <>
          <div className="os-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="os-dropdown">
            {versions.map((ver) => (
              <button
                key={ver}
                className={`os-dropdown-item ${version === ver ? 'selected' : ''}`}
                onClick={() => { onVersionChange(ver); onSelect(os.id); setOpen(false); }}
              >
                <span>{ver}</span>
                <span className="os-dropdown-check">✓</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export type { ProfileFormData };
