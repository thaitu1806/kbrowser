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
    // Auto-resolve timezone & locale from proxy IP before launching browser
    // Only resolve when proxy is configured — without proxy, keep the saved config values
    if (proxyOption) {
      try {
        const proxyForGeo = {
          protocol: row.proxy_id ? (this.db.prepare('SELECT protocol FROM proxies WHERE id = ?').get(row.proxy_id) as { protocol: string })?.protocol || 'http' : 'http',
          host: proxyOption.server.replace(/^.*:\/\//, '').split(':')[0],
          port: parseInt(proxyOption.server.split(':').pop() || '0', 10),
          username: proxyOption.username,
          password: proxyOption.password,
        };
        const geoInfo = await resolveGeoFromProxy(proxyForGeo);

        if (geoInfo && fpConfig) {
          fpConfig.timezone = geoInfo.timezone;
          fpConfig.locale = geoInfo.locale;
          console.log(`[GeoResolver] Proxy IP: ${geoInfo.ip} → timezone: ${geoInfo.timezone}, locale: ${geoInfo.locale} (${geoInfo.city}, ${geoInfo.country})`);
        }
      } catch (geoErr) {
        console.warn('[GeoResolver] Failed to resolve geo from proxy, using config defaults:', geoErr);
      }
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
      // Set window size to match screen config — must match spoofed screen.width/height
      `--window-size=${fpConfig?.screen?.width || 1920},${fpConfig?.screen?.height || 1080}`,
      // Start maximized so window fills the screen (prevents screen vs window mismatch)
      '--start-maximized',
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

    // Auto-detect Chrome stable installation and use it instead of Playwright's Chromium
    // Playwright's bundled Chromium is a dev/canary build — its TLS fingerprint, JS capabilities,
    // and internal version differ from Chrome stable, causing BrowserScan "Detection" flags.
    // Using real Chrome stable eliminates kernel/UA mismatch entirely.
    let useRealChrome = false;
    let detectedChromeVersion = '';
    let detectedChromePath = '';

    if (row.browser_type !== 'firefox') {
      // Check if Chrome stable is installed on the system
      // Include hardcoded common paths as fallback in case env vars are missing in Electron
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env['PROGRAMFILES'] ? path.join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
        process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
        process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      ].filter(Boolean);

      for (const chromePath of chromePaths) {
        if (fs.existsSync(chromePath)) {
          useRealChrome = true;
          detectedChromePath = chromePath;
          // Try to read Chrome version from the version file next to chrome.exe
          // NOTE: Chrome can have multiple version folders during updates.
          // The LOWEST version is usually the one currently running (new version pending restart).
          // However, we don't rely on this — after launch we verify the actual kernel version.
          try {
            const chromeDir = path.dirname(chromePath);
            const versionDirs = fs.readdirSync(chromeDir).filter((d: string) => /^\d+\.\d+\.\d+\.\d+$/.test(d));
            if (versionDirs.length > 0) {
              // Sort ascending — take the LOWEST version as it's likely the running one
              // (Chrome downloads new version folder but doesn't use it until restart)
              versionDirs.sort((a: string, b: string) => {
                const pa = a.split('.').map(Number);
                const pb = b.split('.').map(Number);
                for (let i = 0; i < 4; i++) {
                  if (pa[i] !== pb[i]) return pa[i] - pb[i];
                }
                return 0;
              });
              // If there are multiple versions, prefer the lower one (currently running)
              // The post-launch verification will correct this if wrong
              detectedChromeVersion = versionDirs.length > 1 ? versionDirs[0] : versionDirs[0];
            }
          } catch {
            // Ignore version detection errors
          }
          console.log(`[Chrome] Found Chrome stable: ${chromePath} (version: ${detectedChromeVersion || 'unknown'}, folders: ${fs.existsSync(path.dirname(chromePath)) ? 'checked' : 'n/a'})`);
          break;
        }
      }

      if (!useRealChrome) {
        console.warn('[Chrome] Chrome stable not found, falling back to Playwright Chromium (may trigger BrowserScan detection)');
      }
    }

    // DO NOT set User-Agent in launch options — let the browser report its real UA first.
    // After launch, we read the kernel's real version and build a consistent UA from it.
    // This eliminates BrowserScan "version mismatch" detection entirely.
    let effectiveUserAgent = fpConfig?.userAgent || '';

    // Build launch options
    const screenW = fpConfig?.screen?.width || 1920;
    const screenH = fpConfig?.screen?.height || 1080;

    // Try to use real Chrome instead of Playwright's Chromium (less detectable)
    const launchOptions: Record<string, unknown> = {
      headless: false,
      args: row.browser_type === 'firefox' ? [] : chromiumArgs,
      // Viewport must be null so CDP Emulation controls screen size entirely
      viewport: null,
      // Screen hint for Playwright (CDP will override this)
      screen: { width: screenW, height: screenH },
      ignoreDefaultArgs: ['--enable-automation'],
      colorScheme: 'light',
      // Use real Chrome executable path — channel doesn't work with launchPersistentContext
      ...(useRealChrome && detectedChromePath ? { executablePath: detectedChromePath } : {}),
      env: {
        ...process.env,
        GOOGLE_API_KEY: 'no',
        GOOGLE_DEFAULT_CLIENT_ID: 'no',
        GOOGLE_DEFAULT_CLIENT_SECRET: 'no',
      },
      // Apply proxy if configured
      ...(proxyOption ? { proxy: proxyOption } : {}),
      // DO NOT set userAgent here — we will read the real kernel UA after launch
      // and then override via CDP with the correct version number
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

    // Log launch config for debugging kernel/UA mismatch
    console.log(`[Launch] executablePath: ${(launchOptions as Record<string, unknown>).executablePath || 'Playwright default'}`);
    console.log(`[Launch] useRealChrome: ${useRealChrome}, detectedChromePath: ${detectedChromePath || 'none'}`);

    // Launch persistent browser context with isolated user data dir
    const context = await browserType.launchPersistentContext(profileDir, launchOptions);

    // CRITICAL: Monkey-patch context to auto-disable Runtime after each enable
    // This prevents Runtime.consoleAPICalled leak that Pixelscan detects as IsDevtoolOpen.
    // Playwright internally calls Runtime.enable on every new page/frame — we can't prevent that,
    // but we CAN immediately disable it after the execution contexts are captured.
    try {
      const origNewCDPSession = context.newCDPSession.bind(context);
      (context as unknown as { newCDPSession: typeof context.newCDPSession }).newCDPSession = async function(page: import('playwright').Page) {
        const session = await origNewCDPSession(page);
        const origSend = session.send.bind(session);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any).send = function(method: string, params?: unknown) {
          const result = (origSend as any)(method, params);
          if (method === 'Runtime.enable') {
            (result as Promise<unknown>).then(() => {
              (origSend as any)('Runtime.disable', {}).catch(() => {});
            }).catch(() => {});
          }
          return result;
        };
        return session;
      };
    } catch {
      // If monkey-patching fails, continue without it
    }

    // CRITICAL: Get the REAL browser kernel version after launch.
    // BrowserScan detects version by testing JS/CSS features — we MUST match the real kernel.
    // Strategy: Read the browser's native UA, extract the real Chrome version,
    // then build our spoofed UA using that exact version number.
    let kernelChromeVersion = '';
    try {
      const firstPage = context.pages()[0] || await context.newPage();
      const nativeUA = await firstPage.evaluate('navigator.userAgent') as string;
      const kernelMatch = nativeUA.match(/Chrome\/([\d.]+)/);
      if (kernelMatch) {
        kernelChromeVersion = kernelMatch[1];
        console.log(`[UA] Real kernel Chrome version: ${kernelChromeVersion}`);
      }
    } catch {
      // Fallback: use detected Chrome version or Playwright version
      kernelChromeVersion = detectedChromeVersion || '148.0.0.0';
      console.warn(`[UA] Could not read kernel version, using fallback: ${kernelChromeVersion}`);
    }

    // Now build the effective UA with the REAL kernel version
    if (effectiveUserAgent && kernelChromeVersion && row.browser_type !== 'firefox') {
      effectiveUserAgent = effectiveUserAgent.replace(/Chrome\/[\d.]+/, `Chrome/${kernelChromeVersion}`);
      // Also fix Safari version suffix if present (should match Chrome major)
      const safariMatch = effectiveUserAgent.match(/Safari\/[\d.]+/);
      if (safariMatch) {
        // Safari version in Chrome UA is always 537.36
        effectiveUserAgent = effectiveUserAgent.replace(/Safari\/[\d.]+/, 'Safari/537.36');
      }
      console.log(`[UA] Final effectiveUserAgent: ${effectiveUserAgent}`);
    }

    // Derive platform metadata from fpConfig for consistent spoofing
    // This maps the navigator.platform value to the correct Client Hints metadata
    const cfgPlatform = fpConfig?.platform || 'Win32';
    const cfgOsVersion = fpConfig?.osVersion || ''; // e.g. 'Windows 10', 'macOS 26', 'Android 14'
    const isWindows = cfgPlatform === 'Win32' || cfgPlatform.includes('Win');
    const isMac = cfgPlatform === 'MacIntel' || cfgPlatform.includes('Mac');
    const isLinux = (cfgPlatform === 'Linux x86_64' || cfgPlatform === 'Linux') && !cfgPlatform.includes('armv');
    const isAndroid = cfgPlatform === 'Linux armv81' || cfgPlatform.includes('armv');
    const isIOS = cfgPlatform === 'iPhone' || cfgPlatform.includes('iPhone');

    // Client Hints platform name (different from navigator.platform)
    const chPlatform = isMac ? 'macOS' : isAndroid ? 'Android' : isIOS ? 'iOS' : isLinux ? 'Linux' : 'Windows';

    // Platform version for Client Hints — use osVersion from config for accuracy
    // This is critical because BrowserScan compares platformVersion with UA and detects mismatches
    let chPlatformVersion = '10.0.0';
    if (isMac) {
      // Use osVersion config first, fallback to parsing UA
      const macVer = cfgOsVersion.match(/(\d+)/);
      if (macVer) {
        chPlatformVersion = `${macVer[1]}.1.0`;
      } else {
        const macVerMatch = effectiveUserAgent.match(/Mac OS X (\d+)[_.](\d+)[_.](\d+)/);
        chPlatformVersion = macVerMatch ? `${macVerMatch[1]}.${macVerMatch[2]}.${macVerMatch[3]}` : '15.1.0';
      }
    } else if (isAndroid) {
      // Use osVersion config first, fallback to parsing UA
      const androidVer = cfgOsVersion.match(/(\d+)/);
      if (androidVer) {
        chPlatformVersion = `${androidVer[1]}.0.0`;
      } else {
        const androidMatch = effectiveUserAgent.match(/Android (\d+)/);
        chPlatformVersion = androidMatch ? `${androidMatch[1]}.0.0` : '14.0.0';
      }
    } else if (isIOS) {
      // Use osVersion config first, fallback to parsing UA
      const iosVer = cfgOsVersion.match(/(\d+)/);
      if (iosVer) {
        chPlatformVersion = `${iosVer[1]}.0.0`;
      } else {
        const iosMatch = effectiveUserAgent.match(/iPhone OS (\d+)/);
        chPlatformVersion = iosMatch ? `${iosMatch[1]}.0.0` : '17.0.0';
      }
    } else if (isLinux) {
      // Linux kernel version — use osVersion to derive a realistic kernel version
      const linuxVer = cfgOsVersion.match(/(\d+)/);
      if (cfgOsVersion.includes('Ubuntu 24') || cfgOsVersion.includes('Fedora 40')) {
        chPlatformVersion = '6.8.0';
      } else if (cfgOsVersion.includes('Ubuntu 22') || cfgOsVersion.includes('Fedora 39')) {
        chPlatformVersion = '6.5.0';
      } else if (cfgOsVersion.includes('Ubuntu 20') || cfgOsVersion.includes('Debian 11')) {
        chPlatformVersion = '5.15.0';
      } else if (cfgOsVersion.includes('Debian 12')) {
        chPlatformVersion = '6.1.0';
      } else {
        chPlatformVersion = '6.1.0';
      }
    } else if (isWindows) {
      // Use osVersion from config to correctly distinguish Win versions
      // Also fallback to UA string for profiles created before osVersion field was added
      if (cfgOsVersion.includes('11')) {
        chPlatformVersion = '15.0.0'; // Windows 11
      } else if (cfgOsVersion.includes('10')) {
        chPlatformVersion = '10.0.0'; // Windows 10
      } else if (cfgOsVersion.includes('8') || effectiveUserAgent.includes('Windows NT 6.3')) {
        chPlatformVersion = '6.3.0'; // Windows 8/8.1
      } else if (cfgOsVersion.includes('7') || effectiveUserAgent.includes('Windows NT 6.1')) {
        chPlatformVersion = '6.1.0'; // Windows 7
      } else if (effectiveUserAgent.includes('Windows NT 10.0')) {
        // UA says NT 10.0 but no osVersion set — default to Win10
        chPlatformVersion = '10.0.0';
      } else {
        chPlatformVersion = '10.0.0';
      }
    }
    // Architecture
    const chArchitecture = isMac ? 'arm' : isAndroid ? 'arm' : isIOS ? 'arm' : 'x86';
    // Bitness
    const chBitness = isAndroid || isIOS ? '32' : '64';
    // Mobile
    const chMobile = isAndroid || isIOS;

    // Apply the kernel-matched UA immediately via CDP on the first page
    try {
      const fixPage = context.pages()[0];
      if (fixPage && effectiveUserAgent && kernelChromeVersion) {
        const fixCdp = await context.newCDPSession(fixPage);
        const fixMajorVersion = kernelChromeVersion.split('.')[0];
        await fixCdp.send('Emulation.setUserAgentOverride', {
          userAgent: effectiveUserAgent,
          platform: fpConfig?.platform || 'Win32',
          userAgentMetadata: {
            brands: [
              { brand: 'Google Chrome', version: fixMajorVersion },
              { brand: 'Chromium', version: fixMajorVersion },
              { brand: 'Not-A.Brand', version: '24' },
            ],
            fullVersionList: [
              { brand: 'Google Chrome', version: kernelChromeVersion },
              { brand: 'Chromium', version: kernelChromeVersion },
              { brand: 'Not-A.Brand', version: '24.0.0.0' },
            ],
            fullVersion: kernelChromeVersion,
            platform: chPlatform,
            platformVersion: chPlatformVersion,
            architecture: chArchitecture,
            model: '',
            mobile: chMobile,
            bitness: chBitness,
            wow64: false,
          },
        });
        await fixCdp.detach();
        console.log(`[UA] Applied kernel-matched UA via CDP`);
        console.log(`[Platform] chPlatform=${chPlatform}, chPlatformVersion=${chPlatformVersion}, cfgOsVersion=${cfgOsVersion}, cfgPlatform=${cfgPlatform}`);
      }
    } catch {
      // CDP might not be available yet — the main CDP injection below will handle it
    }

    // Force correct Accept-Language AND Sec-CH-UA headers on ALL requests via route interception
    // This is critical because BrowserScan reads Sec-CH-UA from HTTP headers, not just JS APIs
    const acceptLangHeader = fpConfig?.locale
      ? `${fpConfig.locale},${fpConfig.locale.split('-')[0]};q=0.9`
      : 'en-US,en;q=0.9';
    const kernelMajor = (kernelChromeVersion || '148').split('.')[0];
    const secChUaHeader = `"Google Chrome";v="${kernelMajor}", "Chromium";v="${kernelMajor}", "Not-A.Brand";v="24"`;
    const secChUaFullHeader = `"Google Chrome";v="${kernelChromeVersion || '148.0.0.0'}", "Chromium";v="${kernelChromeVersion || '148.0.0.0'}", "Not-A.Brand";v="24.0.0.0"`;

    await context.route('**/*', (route) => {
      const headers = { ...route.request().headers() };
      headers['accept-language'] = acceptLangHeader;
      // Override ALL Sec-CH-UA headers unconditionally — BrowserScan reads these from HTTP headers
      // Chrome sends real machine values by default; we MUST override them in every request
      headers['sec-ch-ua'] = secChUaHeader;
      headers['sec-ch-ua-full-version-list'] = secChUaFullHeader;
      // Override Sec-CH-UA-Platform to match configured OS
      headers['sec-ch-ua-platform'] = `"${chPlatform}"`;
      // Override Sec-CH-UA-Mobile to match configured OS
      headers['sec-ch-ua-mobile'] = chMobile ? '?1' : '?0';
      // ALWAYS set platform-version — this is the key header BrowserScan uses to detect real OS
      // Chrome sends the REAL Windows version here; we must override it unconditionally
      headers['sec-ch-ua-platform-version'] = `"${chPlatformVersion}"`;
      // Also override other high-entropy hints that might leak real machine info
      headers['sec-ch-ua-arch'] = `"${chArchitecture}"`;
      headers['sec-ch-ua-bitness'] = `"${chBitness}"`;
      headers['sec-ch-ua-model'] = '""';
      headers['sec-ch-ua-wow64'] = '?0';
      // Ensure User-Agent header matches
      if (effectiveUserAgent) {
        headers['user-agent'] = effectiveUserAgent;
      }
      route.continue({ headers });
    });

    // Anti-bot detection strategy:
    // CRITICAL: Minimize CDP session usage to avoid Runtime.Enable detection (IsDevtoolOpen).
    // Pixelscan/Cloudflare detect CDP via Runtime.consoleAPICalled side-effect.
    // Strategy:
    // 1. Use CDP ONCE for Page.addScriptToEvaluateOnNewDocument (persists after detach)
    // 2. Use CDP for Emulation.setUserAgentOverride (session-scoped, keep session alive but disable Runtime)
    // 3. Use context.addInitScript() as backup
    const screenW2 = fpConfig?.screen?.width || 1920;
    const screenH2 = fpConfig?.screen?.height || 1080;
    const colorDepth2 = fpConfig?.screen?.colorDepth || 24;
    const cpuCores = fpConfig?.cpu?.cores || 4;
    const ramGB = fpConfig?.ram?.sizeGB || 8;

    // Parse Chrome version for Client Hints — use kernel version (already verified)
    const chromeFullVersion = kernelChromeVersion || '148.0.0.0';
    const chromeMajorVersion = chromeFullVersion.split('.')[0];

    // The MAIN anti-detection script — injected via CDP to run BEFORE any page JS
    // This is critical because Playwright sets navigator.webdriver=true at engine level
    // and addInitScript runs AFTER that. CDP Page.addScriptToEvaluateOnNewDocument runs BEFORE.
    const antiDetectionScript = `
      (function() {
        'use strict';

        // === WEBDRIVER FIX (MUST be first) ===
        // Playwright/Chromium sets navigator.webdriver=true via the Blink automation flag.
        // Detection sites check:
        // 1. Value (true = automation)
        // 2. Own property on instance (should only be on prototype)
        // 3. Getter toString (should look native)
        // Fix: Delete own property, redefine on prototype with native-looking getter
        try {
          // Remove any own property on the navigator instance first
          delete navigator.webdriver;
        } catch(e) {}
        try {
          // Get the original getter from prototype
          var wdDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
          if (wdDesc && wdDesc.get) {
            // Wrap with Proxy — Proxy is undetectable per ES6 spec
            var newGetter = new Proxy(wdDesc.get, {
              apply: function(target, thisArg, args) { return false; }
            });
            Object.defineProperty(Navigator.prototype, 'webdriver', {
              get: newGetter,
              set: wdDesc.set,
              configurable: true,
              enumerable: true
            });
          } else {
            // No getter exists — define one that returns false
            Object.defineProperty(Navigator.prototype, 'webdriver', {
              get: function webdriver() { return false; },
              set: undefined,
              configurable: true,
              enumerable: true
            });
          }
        } catch(e) {}
        // Do NOT set own property on navigator instance — that's detectable

        // === HARDWARE CONCURRENCY ===
        // Use Proxy on the existing getter to avoid descriptor detection
        try {
          var hcDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');
          if (hcDesc && hcDesc.get) {
            Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
              get: new Proxy(hcDesc.get, {
                apply: function() { return ${cpuCores}; }
              }),
              configurable: true, enumerable: true
            });
          } else {
            Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
              get: function() { return ${cpuCores}; },
              configurable: true, enumerable: true
            });
          }
        } catch(e) {}

        // === DEVICE MEMORY ===
        // Use Proxy on the existing getter to avoid descriptor detection
        try {
          var dmDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory');
          if (dmDesc && dmDesc.get) {
            Object.defineProperty(Navigator.prototype, 'deviceMemory', {
              get: new Proxy(dmDesc.get, {
                apply: function() { return ${ramGB}; }
              }),
              configurable: true, enumerable: true
            });
          } else {
            Object.defineProperty(Navigator.prototype, 'deviceMemory', {
              get: function() { return ${ramGB}; },
              configurable: true, enumerable: true
            });
          }
        } catch(e) {}

        // === NAVIGATOR UA/PLATFORM OVERRIDE ===
        // CRITICAL: CDP Emulation.setUserAgentOverride is session-scoped and only applies
        // to the page the CDP session is attached to. For new tabs/pages, navigator.userAgent
        // falls back to the REAL browser UA (Windows). We MUST override it in JS too.
        try {
          var SPOOF_UA = ${JSON.stringify(effectiveUserAgent)};
          var SPOOF_PLATFORM = ${JSON.stringify(fpConfig?.platform || 'Win32')};
          var SPOOF_APPVERSION = ${JSON.stringify(effectiveUserAgent ? effectiveUserAgent.replace('Mozilla/', '') : (fpConfig?.appVersion || '5.0 (Windows NT 10.0; Win64; x64)'))};
          var SPOOF_OSCPU = ${JSON.stringify(fpConfig?.oscpu || '')};

          var uaDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
          if (uaDesc && uaDesc.get) {
            Object.defineProperty(Navigator.prototype, 'userAgent', {
              get: new Proxy(uaDesc.get, {
                apply: function() { return SPOOF_UA; }
              }),
              configurable: true, enumerable: true
            });
          } else {
            Object.defineProperty(Navigator.prototype, 'userAgent', {
              get: function() { return SPOOF_UA; },
              configurable: true, enumerable: true
            });
          }

          var platDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform');
          if (platDesc && platDesc.get) {
            Object.defineProperty(Navigator.prototype, 'platform', {
              get: new Proxy(platDesc.get, {
                apply: function() { return SPOOF_PLATFORM; }
              }),
              configurable: true, enumerable: true
            });
          } else {
            Object.defineProperty(Navigator.prototype, 'platform', {
              get: function() { return SPOOF_PLATFORM; },
              configurable: true, enumerable: true
            });
          }

          var avDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'appVersion');
          if (avDesc && avDesc.get) {
            Object.defineProperty(Navigator.prototype, 'appVersion', {
              get: new Proxy(avDesc.get, {
                apply: function() { return SPOOF_APPVERSION; }
              }),
              configurable: true, enumerable: true
            });
          } else {
            Object.defineProperty(Navigator.prototype, 'appVersion', {
              get: function() { return SPOOF_APPVERSION; },
              configurable: true, enumerable: true
            });
          }

          // Only define oscpu on Firefox — Chromium does NOT have this property.
          // Adding it on Chromium is detectable by Pixelscan as an anomaly.
          if (SPOOF_OSCPU && ${JSON.stringify(row.browser_type === 'firefox')}) {
            Object.defineProperty(Navigator.prototype, 'oscpu', {
              get: function() { return SPOOF_OSCPU; },
              configurable: true, enumerable: true
            });
          }
        } catch(e) {}

        // === ANTI-CDP/DEVTOOLS DETECTION (IsDevtoolOpen) ===
        // Neutralize Runtime.consoleAPICalled detection via console Proxy
        try {
          var origConsole = console;
          var nativeToString = Function.prototype.toString;
          var handler = {
            get: function(target, prop, receiver) {
              if (prop === Symbol.toStringTag) return 'console';
              if (prop === 'profiles') return undefined;
              var val = target[prop];
              if (typeof val === 'function') {
                var wrapped = function() {
                  return val.apply(target, arguments);
                };
                wrapped.toString = function() { return nativeToString.call(val); };
                Object.defineProperty(wrapped, 'length', { value: val.length });
                Object.defineProperty(wrapped, 'name', { value: val.name || prop });
                return wrapped;
              }
              return val;
            }
          };
          window.console = new Proxy(origConsole, handler);
        } catch(e) {}

        // === SCREEN PROPERTIES ===
        // Always use the configured screen size — this is what we want to report.
        // The window is launched with --window-size matching this config, so there
        // should be no mismatch. Using Math.max() previously caused the REAL screen
        // size to leak through when the real screen was larger than the config.
        var cfgScreenW = ${screenW2};
        var cfgScreenH = ${screenH2};
        var cfgColorDepth = ${colorDepth2};
        var screenProps = {
          width: cfgScreenW, height: cfgScreenH,
          availWidth: cfgScreenW, availHeight: cfgScreenH - 40,
          colorDepth: cfgColorDepth, pixelDepth: cfgColorDepth
        };
        Object.keys(screenProps).forEach(function(prop) {
          var val = screenProps[prop];
          try {
            Object.defineProperty(Screen.prototype, prop, {
              get: function() { return val; },
              configurable: true, enumerable: true
            });
          } catch(e) {}
          try {
            Object.defineProperty(screen, prop, {
              get: function() { return val; },
              configurable: true, enumerable: true
            });
          } catch(e) {}
        });

        // === OUTER WIDTH/HEIGHT ===
        // outerWidth should equal innerWidth (no DevTools side panel)
        // outerHeight should equal innerHeight + chrome UI (title bar + tabs ~ 85px)
        // These must be <= screen.width/height
        try {
          Object.defineProperty(window, 'outerWidth', {
            get: function() { return Math.min(window.innerWidth, cfgScreenW); },
            configurable: true
          });
          Object.defineProperty(window, 'outerHeight', {
            get: function() { return Math.min(window.innerHeight + 85, cfgScreenH); },
            configurable: true
          });
        } catch(e) {}

        // === CLEAN PLAYWRIGHT ARTIFACTS ===
        try {
          delete window.__playwright;
          delete window.__pw_manual;
          delete window.__pwInitScripts;
        } catch(e) {}

        // === CHROME RUNTIME (real Chrome always has this) ===
        try {
          if (!window.chrome) window.chrome = {};
          if (!window.chrome.runtime) {
            Object.defineProperty(window.chrome, 'runtime', {
              value: Object.create(null),
              writable: false, enumerable: true, configurable: false
            });
          }
        } catch(e) {}

        // === DEBUGGER TIMING NEUTRALIZATION ===
        // Intercept Function constructor to strip debugger statements
        try {
          var OrigFunc = Function;
          var NewFunc = function() {
            var args = Array.prototype.slice.call(arguments);
            if (args.length > 0 && typeof args[args.length - 1] === 'string') {
              args[args.length - 1] = args[args.length - 1].replace(/debugger/g, '');
            }
            return OrigFunc.apply(this, args);
          };
          NewFunc.prototype = OrigFunc.prototype;
          Object.defineProperty(NewFunc, 'name', { value: 'Function', configurable: true });
          NewFunc.toString = function() { return 'function Function() { [native code] }'; };
          // Don't override window.Function — it can be detected
          // Instead, just patch the prototype constructor
          Function.prototype.constructor = NewFunc;
        } catch(e) {}

        // === NAVIGATOR.USERAGENTDATA (Client Hints) ===
        // Strategy: Patch the EXISTING NavigatorUAData instance's properties
        // instead of replacing with a plain object. This preserves:
        // - Correct prototype chain (NavigatorUAData.prototype)
        // - Symbol.toStringTag → "[object NavigatorUAData]"
        // - instanceof checks
        // Sites detect spoofing by checking Object.getPrototypeOf(navigator.userAgentData)
        try {
          if (navigator.userAgentData) {
            var uaData = navigator.userAgentData;
            var spoofedBrands = Object.freeze([
              Object.freeze({ brand: 'Google Chrome', version: '${chromeMajorVersion}' }),
              Object.freeze({ brand: 'Chromium', version: '${chromeMajorVersion}' }),
              Object.freeze({ brand: 'Not-A.Brand', version: '24' }),
            ]);

            var spoofedHEV = {
              brands: spoofedBrands,
              mobile: ${chMobile},
              platform: '${chPlatform}',
              platformVersion: '${chPlatformVersion}',
              architecture: '${chArchitecture}',
              bitness: '${chBitness}',
              model: '',
              uaFullVersion: '${chromeFullVersion}',
              fullVersionList: [
                { brand: 'Google Chrome', version: '${chromeFullVersion}' },
                { brand: 'Chromium', version: '${chromeFullVersion}' },
                { brand: 'Not-A.Brand', version: '24.0.0.0' },
              ],
              wow64: false,
            };

            // Override getHighEntropyValues on PROTOTYPE first — catches all access patterns
            // This is critical because BrowserScan may call it before instance override takes effect
            try {
              var UADataProto = Object.getPrototypeOf(uaData);
              if (UADataProto && UADataProto.getHighEntropyValues) {
                var origProtoGetHEV = UADataProto.getHighEntropyValues;
                Object.defineProperty(UADataProto, 'getHighEntropyValues', {
                  value: function getHighEntropyValues(hints) {
                    return Promise.resolve(spoofedHEV);
                  },
                  writable: true, configurable: true, enumerable: true
                });
                // Make toString look native
                UADataProto.getHighEntropyValues.toString = function() {
                  return 'function getHighEntropyValues() { [native code] }';
                };
              }
            } catch(e) {}

            // Override 'brands' getter on the instance
            Object.defineProperty(uaData, 'brands', {
              get: function() { return spoofedBrands; },
              configurable: true, enumerable: true
            });

            // Override 'mobile' getter on the instance
            Object.defineProperty(uaData, 'mobile', {
              get: function() { return ${chMobile}; },
              configurable: true, enumerable: true
            });

            // Override 'platform' getter on the instance
            Object.defineProperty(uaData, 'platform', {
              get: function() { return '${chPlatform}'; },
              configurable: true, enumerable: true
            });

            // Override getHighEntropyValues on instance too — belt and suspenders
            Object.defineProperty(uaData, 'getHighEntropyValues', {
              value: function getHighEntropyValues(hints) {
                return Promise.resolve(spoofedHEV);
              },
              writable: true, configurable: true, enumerable: true
            });

            // Override toJSON to match native behavior
            Object.defineProperty(uaData, 'toJSON', {
              value: function toJSON() {
                return { brands: spoofedBrands, mobile: ${chMobile}, platform: '${chPlatform}' };
              },
              writable: true, configurable: true, enumerable: true
            });
          }
        } catch(e) {}

        // === PERMISSIONS QUERY FIX ===
        try {
          if (navigator.permissions && navigator.permissions.query) {
            var origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function(desc) {
              if (desc.name === 'notifications') {
                return Promise.resolve({ state: Notification.permission });
              }
              return origQuery(desc);
            };
          }
        } catch(e) {}
      })();
    `;

    try {
      // Use CDP on first page for:
      // 1. Page.addScriptToEvaluateOnNewDocument — persists after detach, runs BEFORE page JS
      // 2. Emulation.setUserAgentOverride — controls HTTP headers (session-scoped)
      // 3. Runtime.disable — prevent consoleAPICalled leak
      const firstPage = context.pages()[0] || await context.newPage();
      const cdp = await context.newCDPSession(firstPage);

      // FIRST: Disable Runtime domain to prevent consoleAPICalled leak
      try {
        await cdp.send('Runtime.disable');
      } catch {
        // May not be enabled yet
      }

      // Inject anti-detection script via CDP (runs before ANY page JS, including webdriver check)
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: antiDetectionScript,
      });

      // Override User-Agent AND Client Hints at engine level
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: effectiveUserAgent,
        platform: fpConfig?.platform || 'Win32',
        userAgentMetadata: {
          brands: [
            { brand: 'Google Chrome', version: chromeMajorVersion },
            { brand: 'Chromium', version: chromeMajorVersion },
            { brand: 'Not-A.Brand', version: '24' },
          ],
          fullVersionList: [
            { brand: 'Google Chrome', version: chromeFullVersion },
            { brand: 'Chromium', version: chromeFullVersion },
            { brand: 'Not-A.Brand', version: '24.0.0.0' },
          ],
          fullVersion: chromeFullVersion,
          platform: chPlatform,
          platformVersion: chPlatformVersion,
          architecture: chArchitecture,
          model: '',
          mobile: chMobile,
          bitness: chBitness,
          wow64: false,
        },
      });

      // Override hardware concurrency at engine level
      try {
        await cdp.send('Emulation.setHardwareConcurrencyOverride', {
          hardwareConcurrency: cpuCores,
        });
      } catch {
        // Older Chromium versions may not support this
      }

      // CRITICAL: Override screen metrics at engine level via CDP
      // This is the most reliable way — it controls what screen.width/height/availWidth/availHeight
      // return at the Blink engine level, before any JS runs.
      // This was present in the working version (ee782166) and its removal caused the regression.
      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: screenW2,
          height: screenH2,
          deviceScaleFactor: 1,
          mobile: chMobile,
          screenWidth: screenW2,
          screenHeight: screenH2,
          screenOrientation: { type: 'landscapePrimary', angle: 0 },
        });
      } catch {
        // Fallback: JS injection handles it
      }

      // CRITICAL: Disable automation flag at engine level
      // This makes navigator.webdriver return false natively (no JS override needed)
      try {
        await (cdp as any).send('Emulation.setAutomationOverride', { enabled: false });
      } catch {
        // Not supported in all Chromium versions — JS fallback handles it
      }

      // Also try Page.setBypassCSP to allow our scripts to modify protected properties
      try {
        await cdp.send('Page.setBypassCSP', { enabled: true });
      } catch {
        // Not critical
      }

      console.log('[CDP] Injected anti-detection script + Emulation overrides, Runtime disabled');

      // NOTE: We keep the CDP session alive (don't detach) because:
      // - Emulation.setUserAgentOverride is session-scoped (lost on detach)
      // - Runtime.disable prevents the consoleAPICalled leak
      // - Page.addScriptToEvaluateOnNewDocument persists regardless
    } catch {
      console.warn('[Spoof] CDP not available, falling back to addInitScript only');
    }

    // ALSO inject via addInitScript as backup (for new pages/tabs)
    // addInitScript applies to ALL pages in the context
    await context.addInitScript(antiDetectionScript);

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

    // Inject fingerprint spoofing scripts — WebRTC and Canvas only
    // (Hardware, Platform, Screen are handled by CDP above)
    if (fpConfig) {
      // WebRTC spoofing — Chromium args handle most of it, JS is backup
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
      // (Screen, Hardware, Platform spoofing handled by CDP injection above)
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
      // CRITICAL: Apply CDP Emulation.setUserAgentOverride to EVERY new page
      // This ensures Client Hints HTTP headers are spoofed for all tabs, not just the first one
      // Without this, new tabs send REAL machine info (e.g., real Windows 11 version)
      (async () => {
        try {
          const pageCdp = await context.newCDPSession(page);
          await pageCdp.send('Emulation.setUserAgentOverride', {
            userAgent: effectiveUserAgent,
            platform: fpConfig?.platform || 'Win32',
            userAgentMetadata: {
              brands: [
                { brand: 'Google Chrome', version: chromeMajorVersion },
                { brand: 'Chromium', version: chromeMajorVersion },
                { brand: 'Not-A.Brand', version: '24' },
              ],
              fullVersionList: [
                { brand: 'Google Chrome', version: chromeFullVersion },
                { brand: 'Chromium', version: chromeFullVersion },
                { brand: 'Not-A.Brand', version: '24.0.0.0' },
              ],
              fullVersion: chromeFullVersion,
              platform: chPlatform,
              platformVersion: chPlatformVersion,
              architecture: chArchitecture,
              model: '',
              mobile: chMobile,
              bitness: chBitness,
              wow64: false,
            },
          });
          // Disable Runtime to prevent consoleAPICalled leak
          try { await pageCdp.send('Runtime.disable'); } catch { /* ignore */ }
          // Keep session alive — don't detach (Emulation override is session-scoped)
        } catch {
          // CDP might fail for some pages (e.g., chrome:// pages) — that's ok
        }
      })();
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
      .prepare(`
        SELECT p.id, p.name, p.status, p.browser_type, p.proxy_id, p.last_used_at,
               pr.host AS proxy_host, pr.port AS proxy_port
        FROM profiles p
        LEFT JOIN proxies pr ON p.proxy_id = pr.id
        WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC
      `)
      .all() as Array<{
        id: string;
        name: string;
        status: string;
        browser_type: string;
        proxy_id: string | null;
        last_used_at: string | null;
        proxy_host: string | null;
        proxy_port: number | null;
      }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status as 'open' | 'closed',
      browserType: row.browser_type as 'chromium' | 'firefox',
      proxyAssigned: row.proxy_host ? `${row.proxy_host}:${row.proxy_port}` : null,
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
        const proxyData = config.proxy as unknown as Record<string, unknown>;
        const checkedIp = (proxyData.checkedIp as string) || null;
        const country = (proxyData.country as string) || null;
        // Check if profile already has a proxy assigned
        if (row.proxy_id) {
          // Update existing proxy record including checked_ip
          this.db.prepare(
            `UPDATE proxies SET protocol = ?, host = ?, port = ?, username = ?, password = ?, checked_ip = ?, country = ? WHERE id = ?`
          ).run(
            config.proxy.protocol,
            config.proxy.host,
            config.proxy.port,
            config.proxy.username || null,
            config.proxy.password || null,
            checkedIp,
            country,
            row.proxy_id,
          );
        } else {
          // Create new proxy record and assign to profile
          const crypto = require('crypto');
          const proxyId = crypto.randomUUID();
          this.db.prepare(
            `INSERT INTO proxies (id, protocol, host, port, username, password, status, last_checked_at, checked_ip, country)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
          ).run(
            proxyId,
            config.proxy.protocol,
            config.proxy.host,
            config.proxy.port,
            config.proxy.username || null,
            config.proxy.password || null,
            checkedIp,
            country,
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
      .prepare(`
        SELECT p.id, p.name, p.status, p.browser_type, p.proxy_id, p.last_used_at,
               pr.host AS proxy_host, pr.port AS proxy_port, pr.protocol AS proxy_protocol,
               pr.checked_ip AS proxy_checked_ip, pr.country AS proxy_country
        FROM profiles p
        LEFT JOIN proxies pr ON p.proxy_id = pr.id
        WHERE p.deleted_at IS NULL
      `)
      .all() as Array<{
        id: string;
        name: string;
        status: string;
        browser_type: string;
        proxy_id: string | null;
        last_used_at: string | null;
        proxy_host: string | null;
        proxy_port: number | null;
        proxy_protocol: string | null;
        proxy_checked_ip: string | null;
        proxy_country: string | null;
      }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status as 'open' | 'closed',
      browserType: row.browser_type as 'chromium' | 'firefox',
      proxyAssigned: row.proxy_checked_ip
        ? `${row.proxy_checked_ip}${row.proxy_country ? '\n' + row.proxy_country : ''}`
        : row.proxy_host ? `${row.proxy_host}:${row.proxy_port}` : null,
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
