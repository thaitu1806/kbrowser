/**
 * Integration Test: Profile + Fingerprint + Proxy
 *
 * Tests the full flow of creating a profile with fingerprint config,
 * assigning a proxy, opening the profile (mocked Playwright), verifying
 * fingerprint injection and proxy configuration, then closing.
 *
 * Task 14.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { initializeDatabase } from '../../main/database/index';
import { ProfileManager } from '../../main/services/profile-manager/profile-manager';
import { FingerprintSpoofer } from '../../main/services/fingerprint-spoofer/fingerprint-spoofer';
import { ProxyManager } from '../../main/services/proxy-manager/proxy-manager';
import type { ProxyCheckerFn } from '../../main/services/proxy-manager/proxy-manager';
import type { FingerprintConfig, ProfileConfig } from '../../shared/types';

// Mock Playwright — we can't launch real browsers in tests
vi.mock('playwright', () => {
  const initScripts: string[] = [];
  const mockBrowserServer = {
    wsEndpoint: () => 'ws://127.0.0.1:9222/devtools/browser/mock-id',
    close: vi.fn(async () => {}),
  };
  const mockBrowserContext = {
    addInitScript: vi.fn(async (script: string | { content: string }) => {
      const content = typeof script === 'string' ? script : script.content;
      initScripts.push(content);
    }),
    close: vi.fn(async () => {}),
  };
  return {
    chromium: {
      launchServer: vi.fn(async () => mockBrowserServer),
      launch: vi.fn(async () => ({
        newContext: vi.fn(async () => mockBrowserContext),
        close: vi.fn(async () => {}),
      })),
    },
    firefox: {
      launchServer: vi.fn(async () => mockBrowserServer),
      launch: vi.fn(async () => ({
        newContext: vi.fn(async () => mockBrowserContext),
        close: vi.fn(async () => {}),
      })),
    },
    _test: { initScripts, mockBrowserContext },
  };
});

function makeFingerprint(): FingerprintConfig {
  return {
    canvas: { noiseLevel: 0.5 },
    webgl: { noiseLevel: 0.3 },
    audioContext: { frequencyOffset: 0.01 },
    cpu: { cores: 8 },
    ram: { sizeGB: 16 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    fonts: ['Arial', 'Verdana', 'Times New Roman'],
    webrtc: 'disable' as const,
    platform: 'Win32',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
    oscpu: 'Windows NT 10.0; Win64; x64',
  };
}

describe('Integration: Profile + Fingerprint + Proxy', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let profileManager: ProfileManager;
  let fingerprintSpoofer: FingerprintSpoofer;
  let proxyManager: ProxyManager;
  const ownerId = 'integration-test-owner';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-integration-pfp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    basePath = path.join(
      os.tmpdir(),
      `test-profiles-pfp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(basePath, { recursive: true });

    db = initializeDatabase(dbPath);

    // Insert test user (required by FK constraint)
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'integrationuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    // Mock proxy checker that always returns alive
    const mockChecker: ProxyCheckerFn = async () => ({
      status: 'alive' as const,
      responseTimeMs: 50,
      checkedAt: new Date().toISOString(),
    });

    profileManager = new ProfileManager(db, basePath);
    fingerprintSpoofer = new FingerprintSpoofer();
    proxyManager = new ProxyManager(db, mockChecker);
  });

  afterEach(() => {
    db.close();
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch { /* ignore */ }
    try {
      fs.rmSync(basePath, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should create a profile with fingerprint, assign proxy, open and close', async () => {
    // 1. Create a profile with fingerprint config
    const fpConfig = makeFingerprint();
    const profileConfig: ProfileConfig = {
      name: 'Integration Test Profile',
      browserType: 'chromium',
      fingerprint: fpConfig,
    };

    const profile = await profileManager.createProfile(profileConfig, ownerId);
    expect(profile.id).toBeDefined();
    expect(profile.name).toBe('Integration Test Profile');
    expect(profile.fingerprintConfig).toEqual(fpConfig);
    expect(profile.status).toBe('closed');

    // 2. Add a proxy and assign it to the profile
    const proxy = await proxyManager.addProxy({
      protocol: 'http',
      host: '192.168.1.100',
      port: 8080,
      username: 'proxyuser',
      password: 'proxypass',
    });
    await proxyManager.assignToProfile(proxy.id, profile.id);

    // Verify proxy is assigned
    const assignedProxy = await proxyManager.getProxyForProfile(profile.id);
    expect(assignedProxy).not.toBeNull();
    expect(assignedProxy!.host).toBe('192.168.1.100');
    expect(assignedProxy!.port).toBe(8080);

    // 3. Generate fingerprint data and verify it
    const fpData = fingerprintSpoofer.generateFingerprint(fpConfig);
    expect(fpData.canvasSeed).toContain('canvas-');
    expect(fpData.webglSeed).toContain('webgl-');
    expect(fpData.audioSeed).toContain('audio-');

    // 4. Validate fingerprint consistency
    const validation = fingerprintSpoofer.validateConsistency(fpData);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // 5. Open the profile (mocked Playwright)
    const connection = await profileManager.openProfile(profile.id);
    expect(connection.wsEndpoint).toBeDefined();
    expect(connection.profileId).toBe(profile.id);

    // 6. Verify profile status is now 'open'
    const profiles = await profileManager.listProfiles();
    const openProfile = profiles.find((p) => p.id === profile.id);
    expect(openProfile?.status).toBe('open');

    // 7. Apply fingerprint to mock browser context
    const playwright = await import('playwright');
    const testUtils = (playwright as any)._test;
    testUtils.initScripts.length = 0; // Clear previous scripts

    await fingerprintSpoofer.applyFingerprint(testUtils.mockBrowserContext, fpData);

    // Verify fingerprint scripts were injected (addInitScript was called)
    expect(testUtils.mockBrowserContext.addInitScript).toHaveBeenCalled();
    // At least canvas, webgl, audio, hardware, user-agent, font scripts
    const callCount = testUtils.mockBrowserContext.addInitScript.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(6);

    // 8. Verify proxy config is available in Playwright format
    const pwProxy = proxyManager.getPlaywrightProxyConfig(proxy.id);
    expect(pwProxy).not.toBeNull();
    expect(pwProxy!.server).toBe('http://192.168.1.100:8080');
    expect(pwProxy!.username).toBe('proxyuser');
    expect(pwProxy!.password).toBe('proxypass');

    // 9. Close the profile
    await profileManager.closeProfile(profile.id);

    // 10. Verify profile status is now 'closed'
    const profilesAfterClose = await profileManager.listProfiles();
    const closedProfile = profilesAfterClose.find((p) => p.id === profile.id);
    expect(closedProfile?.status).toBe('closed');
  });

  it('should handle SOCKS5 proxy with fingerprint', async () => {
    const fpConfig = makeFingerprint();
    const profile = await profileManager.createProfile(
      { name: 'SOCKS5 Profile', browserType: 'firefox', fingerprint: fpConfig },
      ownerId,
    );

    const proxy = await proxyManager.addProxy({
      protocol: 'socks5',
      host: '10.0.0.1',
      port: 1080,
    });
    await proxyManager.assignToProfile(proxy.id, profile.id);

    const pwProxy = proxyManager.getPlaywrightProxyConfig(proxy.id);
    expect(pwProxy!.server).toBe('socks5://10.0.0.1:1080');
    expect(pwProxy!.username).toBeUndefined();

    const connection = await profileManager.openProfile(profile.id);
    expect(connection.wsEndpoint).toBeDefined();

    await profileManager.closeProfile(profile.id);
  });

  it('should validate proxy before launch', async () => {
    const fpConfig = makeFingerprint();
    const profile = await profileManager.createProfile(
      { name: 'Validate Proxy Profile', browserType: 'chromium', fingerprint: fpConfig },
      ownerId,
    );

    // No proxy assigned — should return 'no_proxy'
    const noProxyResult = await proxyManager.validateProxyBeforeLaunch(profile.id);
    expect(noProxyResult.status).toBe('no_proxy');

    // Assign proxy and validate
    const proxy = await proxyManager.addProxy({
      protocol: 'https',
      host: '10.0.0.2',
      port: 443,
    });
    await proxyManager.assignToProfile(proxy.id, profile.id);

    const readyResult = await proxyManager.validateProxyBeforeLaunch(profile.id);
    expect(readyResult.status).toBe('ready');
    expect(readyResult.proxy).not.toBeNull();
  });
});
