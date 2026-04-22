/**
 * IPC Handlers — Bridge between Electron main process services and renderer.
 *
 * Registers ipcMain.handle() for each operation the UI needs.
 */

import { ipcMain } from 'electron';
import path from 'path';
import { app } from 'electron';
import { initializeDatabase } from './database/index';
import { ProfileManager } from './services/profile-manager/profile-manager';
import { FingerprintSpoofer } from './services/fingerprint-spoofer/fingerprint-spoofer';
import { ProxyManager } from './services/proxy-manager/proxy-manager';
import { RBACSystem } from './services/rbac-system/rbac-system';
import { ActionLogger } from './services/action-logger/action-logger';
import { RPAEngine } from './services/rpa-engine/rpa-engine';
import { ExtensionCenter } from './services/extension-center/extension-center';
import { ProfileSerializer } from './services/profile-serializer/profile-serializer';
import type { ProfileConfig, ProxyConfig } from '../shared/types';

let profileManager: ProfileManager;
let fingerprintSpoofer: FingerprintSpoofer;
let proxyManager: ProxyManager;
let rbacSystem: RBACSystem;
let actionLogger: ActionLogger;
let rpaEngine: RPAEngine;
let extensionCenter: ExtensionCenter;
let profileSerializer: ProfileSerializer;

/** Initialize all services and register IPC handlers. */
export function setupIPC(): void {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'digital-identity.db');
  const profilesBasePath = path.join(userDataPath, 'profiles-data');

  const db = initializeDatabase(dbPath);

  profileManager = new ProfileManager(db, profilesBasePath);
  fingerprintSpoofer = new FingerprintSpoofer();
  proxyManager = new ProxyManager(db);
  rbacSystem = new RBACSystem(db);
  actionLogger = new ActionLogger(db);
  rpaEngine = new RPAEngine(db);
  extensionCenter = new ExtensionCenter(db);
  profileSerializer = new ProfileSerializer();

  // Ensure a default admin user exists
  ensureDefaultUser();

  // ─── Profile handlers ───
  ipcMain.handle('profile:list', async () => {
    return profileManager.listProfiles();
  });

  ipcMain.handle('profile:get', async (_event, profileId: string) => {
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as {
      id: string; name: string; browser_type: string; owner_id: string; status: string;
      fingerprint_config: string | null; proxy_id: string | null;
      sync_enabled: number; sync_status: string | null;
      last_used_at: string | null; created_at: string; updated_at: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      browserType: row.browser_type,
      ownerId: row.owner_id,
      status: row.status,
      fingerprintConfig: row.fingerprint_config ? JSON.parse(row.fingerprint_config) : null,
      proxyId: row.proxy_id,
      syncEnabled: row.sync_enabled === 1,
      syncStatus: row.sync_status,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  ipcMain.handle('profile:create', async (_event, config: ProfileConfig) => {
    const defaultUser = getDefaultUserId();
    const profile = await profileManager.createProfile(config, defaultUser);
    await actionLogger.log({
      userId: defaultUser, username: 'admin', action: 'profile.create',
      profileId: profile.id, details: { name: config.name },
    });
    return profile;
  });

  ipcMain.handle('profile:open', async (event, profileId: string) => {
    // Ensure Playwright browsers are installed
    try {
      const { execSync } = require('child_process');
      // Try to install chromium if not present
      execSync('npx playwright install chromium', {
        stdio: 'pipe',
        cwd: path.join(__dirname, '..', '..'),
        timeout: 300000, // 5 minutes max
      });
    } catch {
      // Ignore — will fail at launch if truly missing
    }

    const connection = await profileManager.openProfile(profileId);
    const defaultUser = getDefaultUserId();
    await actionLogger.log({
      userId: defaultUser, username: 'admin', action: 'profile.open',
      profileId, details: { wsEndpoint: connection.wsEndpoint },
    });
    return connection;
  });

  ipcMain.handle('profile:close', async (_event, profileId: string) => {
    await profileManager.closeProfile(profileId);
    const defaultUser = getDefaultUserId();
    await actionLogger.log({
      userId: defaultUser, username: 'admin', action: 'profile.close',
      profileId, details: {},
    });
  });

  ipcMain.handle('profile:delete', async (_event, profileId: string) => {
    await profileManager.deleteProfile(profileId);
    const defaultUser = getDefaultUserId();
    await actionLogger.log({
      userId: defaultUser, username: 'admin', action: 'profile.delete',
      profileId, details: {},
    });
  });

  ipcMain.handle('profile:update', async (_event, profileId: string, config: Partial<ProfileConfig>) => {
    return profileManager.updateProfile(profileId, config);
  });

  // ─── Proxy handlers ───
  ipcMain.handle('proxy:list', async () => {
    const rows = db.prepare('SELECT * FROM proxies').all();
    return rows;
  });

  ipcMain.handle('proxy:add', async (_event, config: ProxyConfig) => {
    return proxyManager.addProxy(config);
  });

  ipcMain.handle('proxy:remove', async (_event, proxyId: string) => {
    await proxyManager.removeProxy(proxyId);
  });

  ipcMain.handle('proxy:check', async (_event, proxyId: string) => {
    return proxyManager.checkProxy(proxyId);
  });

  /** Check proxy connectivity and get geo info without saving to DB. */
  ipcMain.handle('proxy:checkDirect', async (_event, config: ProxyConfig) => {
    const http = await import('http');
    const https = await import('https');
    const start = Date.now();

    return new Promise<{
      success: boolean;
      ip?: string;
      country?: string;
      region?: string;
      city?: string;
      responseTimeMs: number;
      error?: string;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, responseTimeMs: Date.now() - start, error: 'Timeout after 15s' });
      }, 15000);

      // Use ip-api.com for geo lookup (free, no key needed)
      const req = http.default.get('http://ip-api.com/json/?fields=query,country,regionName,city,status', {
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timeout);
          const elapsed = Date.now() - start;
          try {
            const json = JSON.parse(data);
            if (json.status === 'success') {
              resolve({
                success: true,
                ip: json.query,
                country: json.country,
                region: json.regionName,
                city: json.city,
                responseTimeMs: elapsed,
              });
            } else {
              resolve({ success: true, ip: json.query || 'Unknown', responseTimeMs: elapsed });
            }
          } catch {
            resolve({ success: true, ip: 'Connected', responseTimeMs: elapsed });
          }
        });
      });
      req.on('error', (err: Error) => {
        clearTimeout(timeout);
        resolve({ success: false, responseTimeMs: Date.now() - start, error: err.message });
      });
    });
  });

  ipcMain.handle('proxy:assign', async (_event, proxyId: string, profileId: string) => {
    await proxyManager.assignToProfile(proxyId, profileId);
  });

  ipcMain.handle('proxy:validate', async (_event, profileId: string) => {
    return proxyManager.validateProxyBeforeLaunch(profileId);
  });

  // ─── Fingerprint handlers ───
  ipcMain.handle('fingerprint:generate', async (_event, config) => {
    return fingerprintSpoofer.generateFingerprint(config);
  });

  ipcMain.handle('fingerprint:validate', async (_event, fpData) => {
    return fingerprintSpoofer.validateConsistency(fpData);
  });

  // ─── Extension handlers ───
  ipcMain.handle('extension:list', async () => {
    return extensionCenter.listExtensions();
  });

  ipcMain.handle('extension:upload', async (_event, fileData: number[], filename: string) => {
    return extensionCenter.uploadExtension(Buffer.from(fileData), filename);
  });

  ipcMain.handle('extension:remove', async (_event, extensionId: string) => {
    await extensionCenter.removeExtension(extensionId);
  });

  ipcMain.handle('extension:assign', async (_event, extensionId: string, profileIds: string[]) => {
    await extensionCenter.assignToProfiles(extensionId, profileIds);
  });

  ipcMain.handle('extension:forProfile', async (_event, profileId: string) => {
    return extensionCenter.getExtensionsForProfile(profileId);
  });

  // ─── RPA handlers ───
  ipcMain.handle('rpa:execute', async (_event, profileId: string, script) => {
    return rpaEngine.executeScript(profileId, script);
  });

  ipcMain.handle('rpa:save', async (_event, script) => {
    return rpaEngine.saveScript(script);
  });

  ipcMain.handle('rpa:load', async (_event, scriptId: string) => {
    return rpaEngine.loadScript(scriptId);
  });

  ipcMain.handle('rpa:templates', async (_event, platform?: string) => {
    return rpaEngine.listTemplates(platform);
  });

  ipcMain.handle('rpa:loadTemplate', async (_event, templateId: string) => {
    return rpaEngine.loadTemplate(templateId);
  });

  // ─── RBAC handlers ───
  ipcMain.handle('rbac:createUser', async (_event, request) => {
    return rbacSystem.createUser(request);
  });

  ipcMain.handle('rbac:updateRole', async (_event, userId: string, role) => {
    await rbacSystem.updateRole(userId, role);
  });

  ipcMain.handle('rbac:checkAccess', async (_event, userId: string, profileId: string, action) => {
    return rbacSystem.checkAccess(userId, profileId, action);
  });

  ipcMain.handle('rbac:shareProfile', async (_event, profileId: string, targetUserId: string, permissions) => {
    await rbacSystem.shareProfile(profileId, targetUserId, permissions);
  });

  ipcMain.handle('rbac:revokeAccess', async (_event, profileId: string, targetUserId: string) => {
    await rbacSystem.revokeAccess(profileId, targetUserId);
  });

  ipcMain.handle('rbac:getUser', async (_event, userId: string) => {
    return rbacSystem.getUser(userId);
  });

  // ─── Action Logger handlers ───
  ipcMain.handle('logs:query', async (_event, filter, callerRole?, callerUserId?) => {
    return actionLogger.query(filter, callerRole, callerUserId);
  });

  ipcMain.handle('logs:cleanup', async () => {
    return actionLogger.cleanup();
  });

  // ─── Serializer handlers ───
  ipcMain.handle('serializer:serialize', async (_event, config: ProfileConfig) => {
    return profileSerializer.serialize(config);
  });

  ipcMain.handle('serializer:deserialize', async (_event, json: string) => {
    return profileSerializer.deserialize(json);
  });

  ipcMain.handle('serializer:validate', async (_event, json: string) => {
    return profileSerializer.validate(json);
  });
}

// ─── Helpers ───

let defaultUserId = '';

function getDefaultUserId(): string {
  return defaultUserId;
}

function ensureDefaultUser(): void {
  const db = profileManager['db'];
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as { id: string } | undefined;
  if (existing) {
    defaultUserId = existing.id;
    return;
  }
  // Create default admin synchronously (no bcrypt needed for bootstrap)
  const crypto = require('crypto');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, api_key, created_at, updated_at)
     VALUES (?, 'admin', 'bootstrap-hash', 'admin', ?, ?, ?)`,
  ).run(id, crypto.randomUUID(), now, now);
  defaultUserId = id;
}
