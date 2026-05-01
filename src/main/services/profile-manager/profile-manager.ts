/**
 * Profile Manager Service
 *
 * Quản lý vòng đời đầy đủ của hồ sơ trình duyệt:
 * tạo, sửa, xóa, mở, đóng hồ sơ với vùng lưu trữ cô lập
 * (Cookie, LocalStorage, IndexedDB, Cache).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { chromium, firefox } from 'playwright';
import type { BrowserContext } from 'playwright';
import type { ProfileConfig, Profile, ProfileSummary, BrowserConnection } from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';
import { resolveGeoFromProxy, resolveGeoFromIP } from '../geo-resolver';

/** Storage types that each profile gets isolated directories for. */
const STORAGE_TYPES = ['cookie', 'localstorage', 'indexeddb', 'cache'] as const;

/** Maps storage type to its subdirectory name within the profile directory. */
const STORAGE_DIR_NAMES: Record<typeof STORAGE_TYPES[number], string> = {
  cookie: 'cookies',
  localstorage: 'localstorage',
  indexeddb: 'indexeddb',
  cache: 'cache',
};

export class ProfileManager {
  private db: Database.Database;
  private basePath: string;
  private openBrowsers: Map<string, BrowserContext> = new Map();

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   * @param basePath - Base directory for profile data storage.
   *   Profile directories will be created under `{basePath}/profiles/{profileId}/`.
   */
  constructor(db: Database.Database, basePath: string) {
    this.db = db;
    this.basePath = basePath;
  }

  /**
   * Creates a new browser profile with isolated storage areas.
   *
   * Steps:
   * 1. Generate a UUID for the profile ID
   * 2. Create the profile directory with subdirectories for each storage type
   * 3. Insert the profile record into the database
   * 4. Insert profile_data records for each storage type
   * 5. Return the created Profile object
   *
   * @param config - Profile configuration (name, browserType, fingerprint, proxy, extensions)
   * @param ownerId - The ID of the user creating the profile
   * @returns The created Profile object
   */
  async createProfile(config: ProfileConfig, ownerId: string): Promise<Profile> {
    const profileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const profileDir = path.join(this.basePath, 'profiles', profileId);

    // Create profile directory and storage subdirectories
    fs.mkdirSync(profileDir, { recursive: true });
    for (const storageType of STORAGE_TYPES) {
      const subDir = path.join(profileDir, STORAGE_DIR_NAMES[storageType]);
      fs.mkdirSync(subDir, { recursive: true });
    }

    // Use a transaction to ensure atomicity of database operations
    const insertProfile = this.db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config, proxy_id, sync_enabled, sync_status, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'closed', ?, NULL, 0, NULL, NULL, ?, ?)
    `);

    const insertProfileData = this.db.prepare(`
      INSERT INTO profile_data (id, profile_id, data_type, data, updated_at)
      VALUES (?, ?, ?, NULL, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertProfile.run(
        profileId,
        config.name,
        config.browserType,
        ownerId,
        JSON.stringify(config.fingerprint),
        now,
        now,
      );

      for (const storageType of STORAGE_TYPES) {
        const dataId = crypto.randomUUID();
        insertProfileData.run(dataId, profileId, storageType, now);
      }
    });

    transaction();

    const profile: Profile = {
      id: profileId,
      name: config.name,
      browserType: config.browserType,
      ownerId,
      status: 'closed',
      fingerprintConfig: config.fingerprint,
      proxyId: null,
      syncEnabled: false,
      syncStatus: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    return profile;
  }

  /**
   * Returns the directory path for a given profile.
   */
  getProfileDir(profileId: string): string {
    return path.join(this.basePath, 'profiles', profileId);
  }

  /**
   * Opens a browser profile by launching a Playwright browser server
   * with the profile's isolated data directory.
   *
   * Steps:
   * 1. Look up the profile in the database
   * 2. Verify the profile exists (throw PROFILE_NOT_FOUND if not)
   * 3. Verify the profile is not already open (throw PROFILE_ALREADY_OPEN if so)
   * 4. Launch a Playwright browser server with the profile's data directory
   * 5. Update profile status to 'open' and last_used_at in the database
   * 6. Track the browser server instance for later cleanup
   * 7. Return BrowserConnection with wsEndpoint and profileId
   *
   * @param profileId - The ID of the profile to open
   * @returns BrowserConnection with WebSocket endpoint for external automation tools
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   * @throws Error with code PROFILE_ALREADY_OPEN if profile is already open
   */
  async openProfile(profileId: string): Promise<BrowserConnection> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT id, name, browser_type, status, fingerprint_config, proxy_id FROM profiles WHERE id = ?')
      .get(profileId) as { id: string; name: string; browser_type: string; status: string; fingerprint_config: string | null; proxy_id: string | null } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    if (row.status === 'open' || this.openBrowsers.has(profileId)) {
      const error = new Error(`Profile is already open: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_ALREADY_OPEN;
      throw error;
    }

    // Get the profile's data directory for isolated browser storage
    const profileDir = this.getProfileDir(profileId);
    fs.mkdirSync(profileDir, { recursive: true });

    // Load proxy config if assigned
    let proxyOption: { server: string; username?: string; password?: string } | undefined;
    if (row.proxy_id) {
      const proxyRow = this.db
        .prepare('SELECT protocol, host, port, username, password FROM proxies WHERE id = ?')
        .get(row.proxy_id) as { protocol: string; host: string; port: number; username: string | null; password: string | null } | undefined;
      if (proxyRow) {
        proxyOption = {
          server: `${proxyRow.protocol}://${proxyRow.host}:${proxyRow.port}`,
          username: proxyRow.username || undefined,
          password: proxyRow.password || undefined,
        };
      }
    }

    // Parse fingerprint config
    const fpConfig = row.fingerprint_config ? JSON.parse(row.fingerprint_config) : null;

    // Auto-resolve timezone & locale from proxy IP before launching browser
    try {
      let geoInfo;
      if (proxyOption) {
        // Resolve through proxy to get the exit IP's geo data
        const proxyForGeo = {
          protocol: row.proxy_id ? (this.db.prepare('SELECT protocol FROM proxies WHERE id = ?').get(row.proxy_id) as { protocol: string })?.protocol || 'http' : 'http',
          host: proxyOption.server.replace(/^.*:\/\//, '').split(':')[0],
          port: parseInt(proxyOption.server.split(':').pop() || '0', 10),
          username: proxyOption.username,
          password: proxyOption.password,
        };
        geoInfo = await resolveGeoFromProxy(proxyForGeo);
      } else {
        // No proxy — resolve from direct IP
        geoInfo = await resolveGeoFromIP();
      }

      if (geoInfo && fpConfig) {
        fpConfig.timezone = geoInfo.timezone;
        fpConfig.locale = geoInfo.locale;
        console.log(`[GeoResolver] IP: ${geoInfo.ip} → timezone: ${geoInfo.timezone}, locale: ${geoInfo.locale} (${geoInfo.city}, ${geoInfo.country})`);
      }
    } catch (geoErr) {
      console.warn('[GeoResolver] Failed to resolve geo from IP, using config defaults:', geoErr);
      // Continue with whatever timezone/locale is in the saved config
    }

    // Select the browser type based on profile configuration
    const browserType = row.browser_type === 'firefox' ? firefox : chromium;

    // Build Chromium args — include WebRTC IP handling policy based on config
    const webrtcMode = fpConfig?.webrtc || 'disable';
    const effectiveLocale = fpConfig?.locale || 'en-US';
    const effectiveLang = effectiveLocale.split('-')[0];
    const chromiumArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--disable-notifications',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-dev-shm-usage',
      '--test-type',
      // Anti-bot detection
      '--disable-features=AutomationControlled,WebRtcHideLocalIpsWithMdns',
      // Set browser language at Chromium engine level — this controls Accept-Language header
      `--lang=${effectiveLocale}`,
      `--accept-lang=${effectiveLocale},${effectiveLang};q=0.9`,
    ];

    // WebRTC leak prevention at browser engine level
    if (webrtcMode === 'disable') {
      chromiumArgs.push('--disable-webrtc');
      chromiumArgs.push('--enforce-webrtc-ip-permission-check');
      chromiumArgs.push('--webrtc-ip-handling-policy=disable_non_proxied_udp');
    } else if (webrtcMode === 'proxy') {
      chromiumArgs.push('--force-webrtc-ip-handling-policy');
      chromiumArgs.push('--webrtc-ip-handling-policy=disable_non_proxied_udp');
      chromiumArgs.push('--enforce-webrtc-ip-permission-check');
    }

    // Auto-detect Chromium version and fix User-Agent to match actual browser
    let effectiveUserAgent = fpConfig?.userAgent || '';
    if (effectiveUserAgent && row.browser_type !== 'firefox') {
      try {
        // Read version from playwright-core's browsers.json
        const pwCorePath = path.dirname(require.resolve('playwright-core/package.json'));
        const browsersJsonPath = path.join(pwCorePath, 'browsers.json');
        if (fs.existsSync(browsersJsonPath)) {
          const browsersJson = JSON.parse(fs.readFileSync(browsersJsonPath, 'utf-8'));
          const chromiumEntry = browsersJson.browsers?.find((b: { name: string }) => b.name === 'chromium');
          if (chromiumEntry?.browserVersion) {
            const realVersion = chromiumEntry.browserVersion;
            effectiveUserAgent = effectiveUserAgent.replace(/Chrome\/[\d.]+/, `Chrome/${realVersion}`);
            console.log(`[UA] Auto-fixed Chrome version in User-Agent: ${realVersion}`);
          }
        }
      } catch {
        console.warn('[UA] Could not auto-detect Chromium version, using configured UA');
      }
    }

    // Build launch options
    const launchOptions: Record<string, unknown> = {
      headless: false,
      args: row.browser_type === 'firefox' ? [] : chromiumArgs,
      viewport: fpConfig?.screen ? { width: fpConfig.screen.width, height: fpConfig.screen.height - 80 } : null,
      ignoreDefaultArgs: ['--enable-automation'],
      env: {
        ...process.env,
        GOOGLE_API_KEY: 'no',
        GOOGLE_DEFAULT_CLIENT_ID: 'no',
        GOOGLE_DEFAULT_CLIENT_SECRET: 'no',
      },
      // Apply proxy if configured
      ...(proxyOption ? { proxy: proxyOption } : {}),
      // Apply User-Agent — use auto-fixed version
      ...(effectiveUserAgent ? { userAgent: effectiveUserAgent } : {}),
      // Apply timezone spoofing (match proxy/IP location)
      ...(fpConfig?.timezone ? { timezoneId: fpConfig.timezone } : {}),
      // Apply locale spoofing
      ...(fpConfig?.locale ? { locale: fpConfig.locale } : {}),
      // Set Accept-Language header with proper quality values to match navigator.languages
      extraHTTPHeaders: {
        'Accept-Language': fpConfig?.locale
          ? `${fpConfig.locale},${fpConfig.locale.split('-')[0]};q=0.9`
          : 'en-US,en;q=0.9',
      },
    };

    // Launch persistent browser context with isolated user data dir
    const context = await browserType.launchPersistentContext(profileDir, launchOptions);

    // Force correct Accept-Language header on ALL requests via route interception
    const acceptLangHeader = fpConfig?.locale
      ? `${fpConfig.locale},${fpConfig.locale.split('-')[0]};q=0.9`
      : 'en-US,en;q=0.9';
    await context.route('**/*', (route) => {
      route.continue({
        headers: {
          ...route.request().headers(),
          'accept-language': acceptLangHeader,
        },
      });
    });

    // Anti-bot detection: remove automation indicators BEFORE any page loads
    await context.addInitScript(`
      // Remove webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });

      // Remove Playwright/automation-specific properties
      delete window.__playwright;
      delete window.__pw_manual;

      // Fix chrome.runtime to look like a real browser
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          connect: function() {},
          sendMessage: function() {},
          id: undefined,
        };
      }

      // Fix permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = function(parameters) {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery.call(this, parameters);
      };

      // Fix plugins to look like a real Chrome browser
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ];
          plugins.length = 3;
          return plugins;
        },
        configurable: true,
      });

      // Fix languages to match locale config
      Object.defineProperty(navigator, 'languages', {
        get: () => ${JSON.stringify(fpConfig?.locale ? [fpConfig.locale, fpConfig.locale.split('-')[0]] : ['en-US', 'en'])},
        configurable: true,
      });
    `);

    // Restore saved cookies from database
    try {
      const cookieRow = this.db
        .prepare('SELECT data FROM profile_data WHERE profile_id = ? AND data_type = ?')
        .get(profileId, 'cookie') as { data: Buffer | null } | undefined;
      if (cookieRow?.data) {
        const cookies = JSON.parse(cookieRow.data.toString('utf-8'));
        if (Array.isArray(cookies) && cookies.length > 0) {
          await context.addCookies(cookies);
        }
      }
    } catch {
      // Ignore cookie restore errors
    }

    // Open fingerprint dashboard as first tab (inline HTML — no server needed)
    try {
      const firstPage = context.pages()[0];
      if (firstPage) {
        await firstPage.setContent(this.getFingerprintDashboardHTML(), { waitUntil: 'domcontentloaded' });
      }
    } catch {
      // Ignore errors
    }

    // Restore saved tabs (open URLs from last session) — all in NEW tabs
    try {
      const tabsRow = this.db
        .prepare('SELECT data FROM profile_data WHERE profile_id = ? AND data_type = ?')
        .get(profileId, 'cache') as { data: Buffer | null } | undefined;
      if (tabsRow?.data) {
        const urls: string[] = JSON.parse(tabsRow.data.toString('utf-8'));
        if (Array.isArray(urls) && urls.length > 0) {
          for (const url of urls) {
            // Skip fingerprint check URL and about:blank
            if (url.includes('fingerprint-check') || url === 'about:blank') continue;
            try {
              const newPage = await context.newPage();
              // Use 'commit' waitUntil — faster, just waits for server response
              await newPage.goto(url, { waitUntil: 'commit', timeout: 30000 });
            } catch {
              // If goto fails, page stays at about:blank — that's ok
            }
            // Small delay between tabs to avoid overwhelming proxy/network
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }
    } catch {
      // Ignore tab restore errors
    }

    // Inject fingerprint spoofing scripts
    if (fpConfig) {
      // Hardware spoofing: CPU cores and RAM
      if (fpConfig.cpu?.cores || fpConfig.ram?.sizeGB) {
        const cores = fpConfig.cpu?.cores || 4;
        const ram = fpConfig.ram?.sizeGB || 8;
        await context.addInitScript(`
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${cores} });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => ${ram} });
        `);
      }

      // Platform spoofing
      if (fpConfig.platform) {
        await context.addInitScript(`
          Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(fpConfig.platform)} });
        `);
      }

      // WebRTC spoofing
      if (fpConfig.webrtc === 'disable') {
        await context.addInitScript(`
          if (typeof window !== 'undefined') {
            window.RTCPeerConnection = function() { throw new DOMException('WebRTC disabled', 'NotSupportedError'); };
            window.RTCPeerConnection.prototype = {};
            if ('webkitRTCPeerConnection' in window) window.webkitRTCPeerConnection = window.RTCPeerConnection;
            if ('mozRTCPeerConnection' in window) window.mozRTCPeerConnection = window.RTCPeerConnection;
            // Also block RTCSessionDescription and RTCIceCandidate
            window.RTCSessionDescription = function() { throw new DOMException('WebRTC disabled', 'NotSupportedError'); };
            window.RTCIceCandidate = function() { throw new DOMException('WebRTC disabled', 'NotSupportedError'); };
            // Block navigator.mediaDevices.getUserMedia for WebRTC
            if (navigator.mediaDevices) {
              navigator.mediaDevices.getUserMedia = function() { return Promise.reject(new DOMException('WebRTC disabled', 'NotAllowedError')); };
            }
          }
        `);
      } else if (fpConfig.webrtc === 'proxy') {
        // Proxy mode: intercept RTCPeerConnection to filter out host candidates (local IP)
        await context.addInitScript(`
          if (typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined') {
            const OrigRTC = RTCPeerConnection;
            window.RTCPeerConnection = function(config) {
              config = config || {};
              config.iceTransportPolicy = 'relay';
              const pc = new OrigRTC(config);
              // Wrap onicecandidate setter to filter host candidates
              const origDesc = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'onicecandidate') || {};
              let userHandler = null;
              Object.defineProperty(pc, 'onicecandidate', {
                get() { return userHandler; },
                set(fn) {
                  userHandler = fn;
                  if (origDesc.set) {
                    origDesc.set.call(pc, function(event) {
                      if (event.candidate && event.candidate.candidate) {
                        if (event.candidate.candidate.indexOf('typ host') !== -1) return;
                        if (event.candidate.candidate.indexOf('typ srflx') !== -1) return;
                      }
                      if (fn) fn.call(this, event);
                    });
                  }
                },
                configurable: true
              });
              return pc;
            };
            window.RTCPeerConnection.prototype = OrigRTC.prototype;
            window.RTCPeerConnection.generateCertificate = OrigRTC.generateCertificate;
            if ('webkitRTCPeerConnection' in window) window.webkitRTCPeerConnection = window.RTCPeerConnection;
          }
        `);
      }

      // Canvas noise
      if (fpConfig.canvas?.noiseLevel > 0) {
        await context.addInitScript(`
          const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function() {
            const ctx = this.getContext('2d');
            if (ctx) {
              const img = ctx.getImageData(0, 0, this.width, this.height);
              for (let i = 0; i < img.data.length; i += 4) {
                img.data[i] = Math.max(0, Math.min(255, img.data[i] + Math.floor((Math.random() - 0.5) * ${Math.ceil(fpConfig.canvas.noiseLevel * 10)})));
              }
              ctx.putImageData(img, 0, 0);
            }
            return origToDataURL.apply(this, arguments);
          };
        `);
      }

      // Screen resolution spoofing
      if (fpConfig.screen) {
        const sw = fpConfig.screen.width || 1920;
        const sh = fpConfig.screen.height || 1080;
        const cd = fpConfig.screen.colorDepth || 24;
        await context.addInitScript(`
          (function() {
            const W = ${sw}, H = ${sh}, CD = ${cd}, AH = ${sh} - 40;
            Object.defineProperty(screen, 'width', { get: () => W, configurable: true });
            Object.defineProperty(screen, 'height', { get: () => H, configurable: true });
            Object.defineProperty(screen, 'availWidth', { get: () => W, configurable: true });
            Object.defineProperty(screen, 'availHeight', { get: () => AH, configurable: true });
            Object.defineProperty(screen, 'colorDepth', { get: () => CD, configurable: true });
            Object.defineProperty(screen, 'pixelDepth', { get: () => CD, configurable: true });
          })();
        `);
      }
    }

    // Get the browser's CDP endpoint for external tools
    const browser = context.browser();
    const wsEndpoint = browser ? `ws://127.0.0.1:0/profile/${profileId}` : `ws://127.0.0.1:0/profile/${profileId}`;

    // Update profile status and last_used_at in the database
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE profiles SET status = ?, last_used_at = ?, updated_at = ? WHERE id = ?')
      .run('open', now, now, profileId);

    // Track the browser context for later cleanup
    this.openBrowsers.set(profileId, context);

    // Save cookies before browser closes
    const saveCookies = async () => {
      try {
        const cookies = await context.cookies();
        if (cookies.length > 0) {
          const cookieJson = JSON.stringify(cookies);
          const now3 = new Date().toISOString();
          // Save to profile_data table
          const existing = this.db
            .prepare('SELECT id FROM profile_data WHERE profile_id = ? AND data_type = ?')
            .get(profileId, 'cookie') as { id: string } | undefined;
          if (existing) {
            this.db
              .prepare('UPDATE profile_data SET data = ?, updated_at = ? WHERE id = ?')
              .run(Buffer.from(cookieJson), now3, existing.id);
          } else {
            this.db
              .prepare('INSERT INTO profile_data (id, profile_id, data_type, data, updated_at) VALUES (?, ?, ?, ?, ?)')
              .run(crypto.randomUUID(), profileId, 'cookie', Buffer.from(cookieJson), now3);
          }
        }
      } catch {
        // Context may already be closed
      }
    };

    // Save open tab URLs to database
    const saveTabs = async () => {
      try {
        const pages = context.pages();
        const urls = pages
          .map((p) => p.url())
          .filter((u) => u && u !== 'about:blank' && !u.startsWith('chrome://') && !u.includes('fingerprint-check'));
        if (urls.length > 0) {
          const tabsJson = JSON.stringify(urls);
          const now4 = new Date().toISOString();
          const existing = this.db
            .prepare('SELECT id FROM profile_data WHERE profile_id = ? AND data_type = ?')
            .get(profileId, 'cache') as { id: string } | undefined;
          if (existing) {
            this.db
              .prepare('UPDATE profile_data SET data = ?, updated_at = ? WHERE id = ?')
              .run(Buffer.from(tabsJson), now4, existing.id);
          } else {
            this.db
              .prepare('INSERT INTO profile_data (id, profile_id, data_type, data, updated_at) VALUES (?, ?, ?, ?, ?)')
              .run(crypto.randomUUID(), profileId, 'cache', Buffer.from(tabsJson), now4);
          }
        }
      } catch {
        // Context may already be closed
      }
    };

    // Auto-save cookies and tabs every 5 seconds while browser is open
    const cookieInterval = setInterval(() => { saveCookies(); saveTabs(); }, 5000);

    // Also save cookies when any page navigates (captures login cookies immediately)
    context.on('page', (page) => {
      page.on('load', () => { saveCookies(); });
    });
    // Save for existing pages too
    for (const page of context.pages()) {
      page.on('load', () => { saveCookies(); });
    }

    // Listen for browser close event (user closes the window)
    context.on('close', () => {
      clearInterval(cookieInterval);
      this.openBrowsers.delete(profileId);
      const now2 = new Date().toISOString();
      try {
        this.db
          .prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?')
          .run('closed', now2, profileId);
      } catch {
        // DB might be closed during app shutdown
      }
    });

    return {
      wsEndpoint,
      profileId,
    };
  }

  /**
   * Returns inline HTML for the fingerprint verification dashboard.
   * Opens external checker sites in new tabs via JavaScript.
   */
  private getFingerprintDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>🛡️ Ken\\'s Browser IM — Fingerprint Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;color:#1e2a3a;padding:20px}
.header{text-align:center;padding:16px 0 20px}
.header h1{font-size:22px;color:#4a6cf7}
.header p{color:#6b7b8d;font-size:13px;margin-top:4px}
.info{background:#fff;border-radius:12px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);display:flex;flex-wrap:wrap;gap:20px;font-size:13px}
.info .item{display:flex;flex-direction:column;gap:2px}
.info .label{font-size:11px;color:#6b7b8d}
.info .val{font-family:'SF Mono',Consolas,monospace;font-size:12px;word-break:break-all}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:20px}
.section-title{font-size:14px;font-weight:600;color:#4a6cf7;margin:20px 0 10px;display:flex;align-items:center;gap:8px}
.card{background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06);cursor:pointer;transition:all .15s;border:1px solid transparent;display:flex;align-items:center;gap:12px}
.card:hover{border-color:#4a6cf7;transform:translateY(-1px);box-shadow:0 4px 12px rgba(74,108,247,.15)}
.card .icon{font-size:24px;flex-shrink:0}
.card .text h3{font-size:13px;font-weight:600;margin-bottom:2px}
.card .text p{font-size:11px;color:#6b7b8d}
.btn-open-all{background:#4a6cf7;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;margin:20px auto;display:block}
.btn-open-all:hover{background:#3b5de7}
</style>
</head>
<body>
<div class="header">
  <h1>🛡️ Ken\\'s Browser IM — Fingerprint Dashboard</h1>
  <p>Click any card to open the checker in a new tab</p>
</div>

<div class="info" id="info"></div>

<div class="section-title">📊 Comprehensive Checks</div>
<div class="grid">
  <div class="card" onclick="window.open('https://browserleaks.com','_blank')">
    <span class="icon">🔍</span>
    <div class="text"><h3>BrowserLeaks</h3><p>Canvas, WebGL, WebRTC, Fonts, Audio, JS — all in one</p></div>
  </div>
  <div class="card" onclick="window.open('https://abrahamjuliot.github.io/creepjs/','_blank')">
    <span class="icon">👻</span>
    <div class="text"><h3>CreepJS</h3><p>Detect fingerprint spoofing, trust score</p></div>
  </div>
  <div class="card" onclick="window.open('https://fingerprintjs.github.io/fingerprintjs/','_blank')">
    <span class="icon">🆔</span>
    <div class="text"><h3>FingerprintJS</h3><p>Popular fingerprinting library demo</p></div>
  </div>
</div>

<div class="section-title">🔎 Specific Checks</div>
<div class="grid">
  <div class="card" onclick="window.open('https://browserleaks.com/webrtc','_blank')">
    <span class="icon">📡</span>
    <div class="text"><h3>WebRTC Leak</h3><p>Check if real IP leaks via WebRTC</p></div>
  </div>
  <div class="card" onclick="window.open('https://browserleaks.com/canvas','_blank')">
    <span class="icon">🎨</span>
    <div class="text"><h3>Canvas Fingerprint</h3><p>Canvas rendering uniqueness</p></div>
  </div>
  <div class="card" onclick="window.open('https://browserleaks.com/webgl','_blank')">
    <span class="icon">🎮</span>
    <div class="text"><h3>WebGL Info</h3><p>Vendor, renderer, extensions</p></div>
  </div>
  <div class="card" onclick="window.open('https://browserleaks.com/javascript','_blank')">
    <span class="icon">⚙️</span>
    <div class="text"><h3>JS / Timezone / CPU</h3><p>Navigator, timezone, hardware info</p></div>
  </div>
  <div class="card" onclick="window.open('https://browserleaks.com/fonts','_blank')">
    <span class="icon">🔤</span>
    <div class="text"><h3>Fonts</h3><p>Detected system fonts</p></div>
  </div>
  <div class="card" onclick="window.open('https://ipleak.net','_blank')">
    <span class="icon">🌐</span>
    <div class="text"><h3>IP / DNS Leak</h3><p>IP address, DNS, proxy detection</p></div>
  </div>
  <div class="card" onclick="window.open('https://www.browserscan.net/IPLocation','_blank')">
    <span class="icon">📍</span>
    <div class="text"><h3>BrowserScan IP Location</h3><p>IP location, timezone, language check</p></div>
  </div>
  <div class="card" onclick="window.open('https://whatismybrowser.com','_blank')">
    <span class="icon">🧭</span>
    <div class="text"><h3>User-Agent / OS</h3><p>Browser detection details</p></div>
  </div>
  <div class="card" onclick="window.open('https://whatismyscreenresolution.net','_blank')">
    <span class="icon">🖥️</span>
    <div class="text"><h3>Screen Resolution</h3><p>Display size and pixel ratio</p></div>
  </div>
</div>

<div class="section-title">🤖 Bot Detection</div>
<div class="grid">
  <div class="card" onclick="window.open('https://bot.sannysoft.com','_blank')">
    <span class="icon">🕵️</span>
    <div class="text"><h3>Sannysoft Bot Test</h3><p>Automation / bot detection checks</p></div>
  </div>
  <div class="card" onclick="window.open('https://pixelscan.net','_blank')">
    <span class="icon">📐</span>
    <div class="text"><h3>PixelScan</h3><p>Fingerprint consistency score</p></div>
  </div>
</div>

<button class="btn-open-all" onclick="openAll()">🚀 Open All Checks (new tabs)</button>

<script>
// Quick info
const info = document.getElementById('info');
const items = [
  ['User-Agent', navigator.userAgent],
  ['Platform', navigator.platform],
  ['Language', navigator.language],
  ['Screen', screen.width+'x'+screen.height],
  ['CPU Cores', navigator.hardwareConcurrency||'?'],
  ['RAM', (navigator.deviceMemory||'?')+' GB'],
  ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
  ['DNT', navigator.doNotTrack||'unset'],
];
items.forEach(([l,v])=>{
  info.innerHTML+='<div class="item"><span class="label">'+l+'</span><span class="val">'+v+'</span></div>';
});

function openAll(){
  const urls=['https://browserleaks.com','https://abrahamjuliot.github.io/creepjs/','https://bot.sannysoft.com','https://pixelscan.net','https://ipleak.net','https://www.browserscan.net/IPLocation'];
  urls.forEach(u=>window.open(u,'_blank'));
}
</script>
</body>
</html>`;
  }

  /**
   * Closes a browser profile by stopping the Playwright browser server,
   * updating the profile status to 'closed' in the database, and removing
   * the browser from the tracking Map.
   *
   * Steps:
   * 1. Look up the profile in the database
   * 2. Throw PROFILE_NOT_FOUND if not found
   * 3. If the profile is already closed and not tracked, return gracefully
   * 4. Close the browser server if it exists in the tracking Map
   * 5. Update profile status to 'closed' in the database
   * 6. Remove the browser server from the tracking Map
   *
   * @param profileId - The ID of the profile to close
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   */
  async closeProfile(profileId: string): Promise<void> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT id, status FROM profiles WHERE id = ?')
      .get(profileId) as { id: string; status: string } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // Get the browser context from the tracking Map
    const context = this.openBrowsers.get(profileId);

    // Save cookies and tabs before closing
    if (context) {
      try {
        const cookies = await context.cookies();
        if (cookies.length > 0) {
          const cookieJson = JSON.stringify(cookies);
          const now3 = new Date().toISOString();
          const existing = this.db
            .prepare('SELECT id FROM profile_data WHERE profile_id = ? AND data_type = ?')
            .get(profileId, 'cookie') as { id: string } | undefined;
          if (existing) {
            this.db
              .prepare('UPDATE profile_data SET data = ?, updated_at = ? WHERE id = ?')
              .run(Buffer.from(cookieJson), now3, existing.id);
          } else {
            this.db
              .prepare('INSERT INTO profile_data (id, profile_id, data_type, data, updated_at) VALUES (?, ?, ?, ?, ?)')
              .run(crypto.randomUUID(), profileId, 'cookie', Buffer.from(cookieJson), now3);
          }
        }
      } catch {
        // Context may already be closing
      }

      // Save open tab URLs
      try {
        const pages = context.pages();
        const urls = pages
          .map((p) => p.url())
          .filter((u) => u && u !== 'about:blank' && !u.startsWith('chrome://') && !u.includes('fingerprint-check'));
        if (urls.length > 0) {
          const tabsJson = JSON.stringify(urls);
          const now4 = new Date().toISOString();
          const existingTab = this.db
            .prepare('SELECT id FROM profile_data WHERE profile_id = ? AND data_type = ?')
            .get(profileId, 'cache') as { id: string } | undefined;
          if (existingTab) {
            this.db
              .prepare('UPDATE profile_data SET data = ?, updated_at = ? WHERE id = ?')
              .run(Buffer.from(tabsJson), now4, existingTab.id);
          } else {
            this.db
              .prepare('INSERT INTO profile_data (id, profile_id, data_type, data, updated_at) VALUES (?, ?, ?, ?, ?)')
              .run(crypto.randomUUID(), profileId, 'cache', Buffer.from(tabsJson), now4);
          }
        }
      } catch {
        // Context may already be closing
      }
    }

    // If the browser context exists, close it
    if (context) {
      await context.close();
    }

    // Update profile status to 'closed' in the database
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?')
      .run('closed', now, profileId);

    // Remove from the tracking Map
    this.openBrowsers.delete(profileId);
  }

  /**
   * Soft-deletes a browser profile by setting deleted_at timestamp.
   * The profile moves to Trash and can be restored later.
   *
   * @param profileId - The ID of the profile to delete
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   */
  async deleteProfile(profileId: string): Promise<void> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT id, status FROM profiles WHERE id = ? AND deleted_at IS NULL')
      .get(profileId) as { id: string; status: string } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // If the profile is currently open, close it first
    if (this.openBrowsers.has(profileId)) {
      await this.closeProfile(profileId);
    }

    // Soft delete: set deleted_at timestamp
    const now = new Date().toISOString();
    this.db.prepare('UPDATE profiles SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, profileId);
  }

  /**
   * Restores a soft-deleted profile from Trash.
   *
   * @param profileId - The ID of the profile to restore
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist in trash
   */
  async restoreProfile(profileId: string): Promise<void> {
    const row = this.db
      .prepare('SELECT id FROM profiles WHERE id = ? AND deleted_at IS NOT NULL')
      .get(profileId) as { id: string } | undefined;

    if (!row) {
      const error = new Error(`Profile not found in trash: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    const now = new Date().toISOString();
    this.db.prepare('UPDATE profiles SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(now, profileId);
  }

  /**
   * Permanently deletes a profile from Trash (hard delete).
   *
   * @param profileId - The ID of the profile to permanently delete
   */
  async permanentlyDeleteProfile(profileId: string): Promise<void> {
    const row = this.db
      .prepare('SELECT id FROM profiles WHERE id = ?')
      .get(profileId) as { id: string } | undefined;

    if (!row) return;

    // Delete from database (CASCADE handles related data)
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);

    // Delete profile directory from filesystem
    const profileDir = this.getProfileDir(profileId);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist; ignore errors
    }
  }

  /**
   * Returns a list of soft-deleted profiles (Trash).
   */
  async listDeletedProfiles(): Promise<ProfileSummary[]> {
    const rows = this.db
      .prepare('SELECT id, name, status, browser_type, proxy_id, last_used_at FROM profiles WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
      .all() as Array<{
        id: string;
        name: string;
        status: string;
        browser_type: string;
        proxy_id: string | null;
        last_used_at: string | null;
      }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status as 'open' | 'closed',
      browserType: row.browser_type as 'chromium' | 'firefox',
      proxyAssigned: row.proxy_id,
      lastUsedAt: row.last_used_at,
    }));
  }

  /**
   * Updates a browser profile's configuration with partial changes.
   *
   * Steps:
   * 1. Look up the profile in the database
   * 2. Throw PROFILE_NOT_FOUND if not found
   * 3. Update only the fields provided in the partial config (name, browserType, fingerprint)
   * 4. Update the updated_at timestamp
   * 5. Return the full updated Profile object
   *
   * @param profileId - The ID of the profile to update
   * @param config - Partial profile configuration with fields to update
   * @returns The updated Profile object
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   */
  async updateProfile(profileId: string, config: Partial<ProfileConfig>): Promise<Profile> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(profileId) as {
        id: string;
        name: string;
        browser_type: string;
        owner_id: string;
        status: string;
        fingerprint_config: string | null;
        proxy_id: string | null;
        sync_enabled: number;
        sync_status: string | null;
        last_used_at: string | null;
        created_at: string;
        updated_at: string;
      } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    const now = new Date().toISOString();

    // Build the update fields based on what's provided
    const updates: string[] = [];
    const params: unknown[] = [];

    if (config.name !== undefined) {
      updates.push('name = ?');
      params.push(config.name);
    }

    if (config.browserType !== undefined) {
      updates.push('browser_type = ?');
      params.push(config.browserType);
    }

    if (config.fingerprint !== undefined) {
      updates.push('fingerprint_config = ?');
      params.push(JSON.stringify(config.fingerprint));
    }

    // Handle proxy assignment: save proxy to proxies table and link to profile
    if (config.proxy !== undefined) {
      if (config.proxy) {
        // Check if profile already has a proxy assigned
        if (row.proxy_id) {
          // Update existing proxy record
          this.db.prepare(
            `UPDATE proxies SET protocol = ?, host = ?, port = ?, username = ?, password = ? WHERE id = ?`
          ).run(
            config.proxy.protocol,
            config.proxy.host,
            config.proxy.port,
            config.proxy.username || null,
            config.proxy.password || null,
            row.proxy_id,
          );
        } else {
          // Create new proxy record and assign to profile
          const crypto = require('crypto');
          const proxyId = crypto.randomUUID();
          this.db.prepare(
            `INSERT INTO proxies (id, protocol, host, port, username, password, status, last_checked_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
          ).run(
            proxyId,
            config.proxy.protocol,
            config.proxy.host,
            config.proxy.port,
            config.proxy.username || null,
            config.proxy.password || null,
          );
          updates.push('proxy_id = ?');
          params.push(proxyId);
        }
      } else {
        // Proxy explicitly set to undefined/null — unassign proxy
        updates.push('proxy_id = ?');
        params.push(null);
      }
    }

    // Always update updated_at
    updates.push('updated_at = ?');
    params.push(now);

    // Add profileId as the last parameter for the WHERE clause
    params.push(profileId);

    this.db
      .prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);

    // Read back the updated row to return the full Profile object
    const updatedRow = this.db
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(profileId) as {
        id: string;
        name: string;
        browser_type: string;
        owner_id: string;
        status: string;
        fingerprint_config: string | null;
        proxy_id: string | null;
        sync_enabled: number;
        sync_status: string | null;
        last_used_at: string | null;
        created_at: string;
        updated_at: string;
      };

    const profile: Profile = {
      id: updatedRow.id,
      name: updatedRow.name,
      browserType: updatedRow.browser_type as 'chromium' | 'firefox',
      ownerId: updatedRow.owner_id,
      status: updatedRow.status as 'open' | 'closed',
      fingerprintConfig: updatedRow.fingerprint_config
        ? JSON.parse(updatedRow.fingerprint_config)
        : null,
      proxyId: updatedRow.proxy_id,
      syncEnabled: updatedRow.sync_enabled === 1,
      syncStatus: updatedRow.sync_status,
      lastUsedAt: updatedRow.last_used_at,
      createdAt: updatedRow.created_at,
      updatedAt: updatedRow.updated_at,
    };

    return profile;
  }

  /**
   * Returns a summary list of all profiles in the database.
   *
   * Each summary includes: id, name, status, browserType, proxyAssigned (proxy_id),
   * and lastUsedAt.
   *
   * @returns Array of ProfileSummary objects
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    const rows = this.db
      .prepare('SELECT id, name, status, browser_type, proxy_id, last_used_at FROM profiles WHERE deleted_at IS NULL')
      .all() as Array<{
        id: string;
        name: string;
        status: string;
        browser_type: string;
        proxy_id: string | null;
        last_used_at: string | null;
      }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status as 'open' | 'closed',
      browserType: row.browser_type as 'chromium' | 'firefox',
      proxyAssigned: row.proxy_id,
      lastUsedAt: row.last_used_at,
    }));
  }

  /**
   * Returns whether a profile's browser is currently tracked as open.
   */
  isProfileOpen(profileId: string): boolean {
    return this.openBrowsers.has(profileId);
  }

  /**
   * Closes all open browser contexts. Called when the app is shutting down.
   */
  async closeAllProfiles(): Promise<void> {
    const openIds = [...this.openBrowsers.keys()];
    for (const profileId of openIds) {
      try {
        await this.closeProfile(profileId);
      } catch {
        // Ignore errors during shutdown
      }
    }
  }
}
