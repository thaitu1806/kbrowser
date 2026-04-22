/**
 * End-to-End Test: Full Flow
 *
 * Tests the complete lifecycle:
 * Create user → Create profile → Configure fingerprint → Add proxy →
 * Assign proxy → Open profile → Execute RPA script → Close profile →
 * Log actions → Verify logs
 *
 * Task 14.6
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
import { RBACSystem } from '../../main/services/rbac-system/rbac-system';
import { RPAEngine } from '../../main/services/rpa-engine/rpa-engine';
import type { ActionExecutorFn } from '../../main/services/rpa-engine/rpa-engine';
import { ActionLogger } from '../../main/services/action-logger/action-logger';
import type { FingerprintConfig, ProfileConfig, RPAScript } from '../../shared/types';

// Mock Playwright
vi.mock('playwright', () => {
  const mockBrowserServer = {
    wsEndpoint: () => 'ws://127.0.0.1:9222/devtools/browser/e2e-test',
    close: vi.fn(async () => {}),
  };
  return {
    chromium: { launchServer: vi.fn(async () => mockBrowserServer) },
    firefox: { launchServer: vi.fn(async () => mockBrowserServer) },
  };
});

function makeFingerprint(): FingerprintConfig {
  return {
    canvas: { noiseLevel: 0.6 },
    webgl: { noiseLevel: 0.4 },
    audioContext: { frequencyOffset: 0.015 },
    cpu: { cores: 8 },
    ram: { sizeGB: 16 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    fonts: ['Arial', 'Helvetica', 'Verdana'],
    webrtc: 'disable' as const,
    platform: 'Win32',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    oscpu: 'Windows NT 10.0; Win64; x64',
  };
}

describe('E2E: Full Flow', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let profileManager: ProfileManager;
  let fingerprintSpoofer: FingerprintSpoofer;
  let proxyManager: ProxyManager;
  let rbacSystem: RBACSystem;
  let rpaEngine: RPAEngine;
  let actionLogger: ActionLogger;

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dbPath = path.join(os.tmpdir(), `test-e2e-${suffix}.db`);
    basePath = path.join(os.tmpdir(), `test-profiles-e2e-${suffix}`);
    fs.mkdirSync(basePath, { recursive: true });

    db = initializeDatabase(dbPath);

    // Mock proxy checker
    const mockChecker: ProxyCheckerFn = async () => ({
      status: 'alive' as const,
      responseTimeMs: 42,
      checkedAt: new Date().toISOString(),
    });

    // Mock RPA action executor — tracks executed actions
    const executedActions: Array<{ profileId: string; type: string }> = [];
    const mockExecutor: ActionExecutorFn = async (profileId, action) => {
      executedActions.push({ profileId, type: action.type });
    };

    profileManager = new ProfileManager(db, basePath);
    fingerprintSpoofer = new FingerprintSpoofer();
    proxyManager = new ProxyManager(db, mockChecker);
    rbacSystem = new RBACSystem(db);
    rpaEngine = new RPAEngine(db, mockExecutor);
    actionLogger = new ActionLogger(db);

    // Store executedActions for assertions
    (globalThis as any).__e2eExecutedActions = executedActions;
  });

  afterEach(() => {
    db.close();
    delete (globalThis as any).__e2eExecutedActions;
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
    try { fs.rmSync(basePath, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should complete the full lifecycle: user → profile → fingerprint → proxy → open → RPA → close → logs', async () => {
    const executedActions = (globalThis as any).__e2eExecutedActions as Array<{
      profileId: string;
      type: string;
    }>;

    // ===== Step 1: Create user =====
    const user = await rbacSystem.createUser({
      username: 'e2e_admin',
      password: 'securePassword123',
      role: 'admin',
    });
    expect(user.id).toBeDefined();
    expect(user.username).toBe('e2e_admin');
    expect(user.role).toBe('admin');

    // Log user creation
    await actionLogger.log({
      userId: user.id,
      username: user.username,
      action: 'create_user',
      details: { username: user.username, role: user.role },
    });

    // ===== Step 2: Create profile =====
    const fpConfig = makeFingerprint();
    const profileConfig: ProfileConfig = {
      name: 'E2E Test Profile',
      browserType: 'chromium',
      fingerprint: fpConfig,
    };

    const profile = await profileManager.createProfile(profileConfig, user.id);
    expect(profile.id).toBeDefined();
    expect(profile.name).toBe('E2E Test Profile');
    expect(profile.status).toBe('closed');

    // Log profile creation
    await actionLogger.log({
      userId: user.id,
      username: user.username,
      action: 'create_profile',
      profileId: profile.id,
      details: { profileName: profile.name, browserType: profile.browserType },
    });

    // ===== Step 3: Configure fingerprint =====
    const fpData = fingerprintSpoofer.generateFingerprint(fpConfig);
    expect(fpData.config).toEqual(fpConfig);
    expect(fpData.canvasSeed).toBeDefined();
    expect(fpData.webglSeed).toBeDefined();
    expect(fpData.audioSeed).toBeDefined();

    // Validate consistency
    const validation = fingerprintSpoofer.validateConsistency(fpData);
    expect(validation.isValid).toBe(true);

    // ===== Step 4: Add proxy =====
    const proxy = await proxyManager.addProxy({
      protocol: 'http',
      host: '203.0.113.50',
      port: 8888,
      username: 'e2eproxy',
      password: 'e2epass',
    });
    expect(proxy.id).toBeDefined();

    // Log proxy addition
    await actionLogger.log({
      userId: user.id,
      username: user.username,
      action: 'add_proxy',
      details: { proxyId: proxy.id, host: proxy.host, port: proxy.port },
    });

    // ===== Step 5: Assign proxy to profile =====
    await proxyManager.assignToProfile(proxy.id, profile.id);

    const assignedProxy = await proxyManager.getProxyForProfile(profile.id);
    expect(assignedProxy).not.toBeNull();
    expect(assignedProxy!.id).toBe(proxy.id);

    // Log proxy assignment
    await actionLogger.log({
      userId: user.id,
      username: user.username,
      action: 'assign_proxy',
      profileId: profile.id,
      details: { proxyId: proxy.id },
    });

    // ===== Step 6: Open profile =====
    const connection = await profileManager.openProfile(profile.id);
    expect(connection.wsEndpoint).toBeDefined();
    expect(connection.profileId).toBe(profile.id);

    // Verify profile is open
    expect(profileManager.isProfileOpen(profile.id)).toBe(true);

    // Log profile open
    await actionLogger.log({
      userId: user.id,
      username: user.username,
      action: 'open_profile',
      profileId: profile.id,
      details: { wsEndpoint: connection.wsEndpoint },
    });

    // ===== Step 7: Execute RPA script =====
    const rpaScript: RPAScript = {
      name: 'E2E Test Script',
      actions: [
        { type: 'navigate', value: 'https://example.com' },
        { type: 'wait', timeout: 1000 },
        { type: 'click', selector: '#main-button' },
        { type: 'type', selector: '#search', value: 'test query' },
        { type: 'screenshot', value: 'e2e-result.png' },
      ],
      errorHandling: 'stop',
    };

    const rpaResult = await rpaEngine.executeScript(profile.id, rpaScript);
    expect(rpaResult.success).toBe(true);
    expect(rpaResult.actionsCompleted).toBe(5);
    expect(rpaResult.totalActions).toBe(5);
    expect(rpaResult.errors).toHaveLength(0);

    // Verify actions were executed in order
    expect(executedActions).toHaveLength(5);
    expect(executedActions[0].type).toBe('navigate');
    expect(executedActions[1].type).toBe('wait');
    expect(executedActions[2].type).toBe('click');
    expect(executedActions[3].type).toBe('type');
    expect(executedActions[4].type).toBe('screenshot');
    expect(executedActions.every((a) => a.profileId === profile.id)).toBe(true);

    // Log RPA execution
    await actionLogger.log({
      userId: user.id,
      username: user.username,
      action: 'execute_rpa',
      profileId: profile.id,
      details: {
        scriptName: rpaScript.name,
        actionsCompleted: rpaResult.actionsCompleted,
        success: rpaResult.success,
      },
    });

    // ===== Step 8: Close profile =====
    await profileManager.closeProfile(profile.id);
    expect(profileManager.isProfileOpen(profile.id)).toBe(false);

    // Verify profile status
    const profiles = await profileManager.listProfiles();
    const closedProfile = profiles.find((p) => p.id === profile.id);
    expect(closedProfile?.status).toBe('closed');

    // Log profile close
    await actionLogger.log({
      userId: user.id,
      username: user.username,
      action: 'close_profile',
      profileId: profile.id,
      details: {},
    });

    // ===== Step 9: Verify action logs =====
    const allLogs = await actionLogger.query({});
    expect(allLogs.length).toBeGreaterThanOrEqual(6);

    // Verify log entries contain required fields
    for (const log of allLogs) {
      expect(log.id).toBeDefined();
      expect(log.userId).toBe(user.id);
      expect(log.username).toBe('e2e_admin');
      expect(log.action).toBeDefined();
      expect(log.timestamp).toBeDefined();
    }

    // Verify specific actions were logged
    const actions = allLogs.map((l) => l.action);
    expect(actions).toContain('create_user');
    expect(actions).toContain('create_profile');
    expect(actions).toContain('add_proxy');
    expect(actions).toContain('assign_proxy');
    expect(actions).toContain('open_profile');
    expect(actions).toContain('execute_rpa');
    expect(actions).toContain('close_profile');

    // Verify profile-related logs have profileId
    const profileLogs = allLogs.filter((l) => l.profileId === profile.id);
    expect(profileLogs.length).toBeGreaterThanOrEqual(4);

    // Verify logs can be filtered by action
    const openLogs = await actionLogger.query({ action: 'open_profile' });
    expect(openLogs).toHaveLength(1);
    expect(openLogs[0].profileId).toBe(profile.id);

    // Verify logs can be filtered by userId
    const userLogs = await actionLogger.query({ userId: user.id });
    expect(userLogs.length).toBeGreaterThanOrEqual(6);
  });

  it('should handle RPA script with error handling in skip mode', async () => {
    const user = await rbacSystem.createUser({
      username: 'e2e_rpa_user',
      password: 'pass123',
      role: 'admin',
    });

    const profile = await profileManager.createProfile(
      {
        name: 'RPA Error Profile',
        browserType: 'chromium',
        fingerprint: makeFingerprint(),
      },
      user.id,
    );

    await profileManager.openProfile(profile.id);

    // Create an executor that fails on the 2nd action
    let actionIndex = 0;
    const failingExecutor: ActionExecutorFn = async (_profileId, _action) => {
      actionIndex++;
      if (actionIndex === 2) {
        throw new Error('Element not found');
      }
    };

    const rpaWithFailingExecutor = new RPAEngine(db, failingExecutor);

    const script: RPAScript = {
      name: 'Skip Error Script',
      actions: [
        { type: 'navigate', value: 'https://example.com' },
        { type: 'click', selector: '#missing' }, // This will fail
        { type: 'screenshot', value: 'result.png' },
      ],
      errorHandling: 'skip',
    };

    const result = await rpaWithFailingExecutor.executeScript(profile.id, script);
    expect(result.actionsCompleted).toBe(2); // 1st and 3rd succeed
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].actionIndex).toBe(1);

    await profileManager.closeProfile(profile.id);
  });
});
