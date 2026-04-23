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

/** Initialize all services and register IPC handlers. Returns profileManager for cleanup. */
export function setupIPC(): { profileManager: ProfileManager } {
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

    // Load proxy details if assigned
    let proxyConfig: { protocol: string; host: string; port: number; username?: string; password?: string } | null = null;
    if (row.proxy_id) {
      const proxyRow = db.prepare('SELECT protocol, host, port, username, password FROM proxies WHERE id = ?').get(row.proxy_id) as {
        protocol: string; host: string; port: number; username: string | null; password: string | null;
      } | undefined;
      if (proxyRow) {
        proxyConfig = {
          protocol: proxyRow.protocol,
          host: proxyRow.host,
          port: proxyRow.port,
          username: proxyRow.username || undefined,
          password: proxyRow.password || undefined,
        };
      }
    }

    return {
      id: row.id,
      name: row.name,
      browserType: row.browser_type,
      ownerId: row.owner_id,
      status: row.status,
      fingerprintConfig: row.fingerprint_config ? JSON.parse(row.fingerprint_config) : null,
      proxyId: row.proxy_id,
      proxyConfig,
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
      execSync('npx playwright install chromium firefox', {
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

  ipcMain.handle('profile:getCookies', async (_event, profileId: string) => {
    const row = db.prepare('SELECT data FROM profile_data WHERE profile_id = ? AND data_type = ?')
      .get(profileId, 'cookie') as { data: Buffer | null } | undefined;
    if (!row || !row.data) return '';
    return row.data.toString('utf-8');
  });

  ipcMain.handle('profile:getTabs', async (_event, profileId: string) => {
    const row = db.prepare('SELECT data FROM profile_data WHERE profile_id = ? AND data_type = ?')
      .get(profileId, 'cache') as { data: Buffer | null } | undefined;
    if (!row || !row.data) return '';
    return row.data.toString('utf-8');
  });

  ipcMain.handle('profile:saveCookies', async (_event, profileId: string, cookieJson: string) => {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM profile_data WHERE profile_id = ? AND data_type = ?')
      .get(profileId, 'cookie') as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE profile_data SET data = ?, updated_at = ? WHERE id = ?')
        .run(Buffer.from(cookieJson), now, existing.id);
    } else {
      const crypto = require('crypto');
      db.prepare('INSERT INTO profile_data (id, profile_id, data_type, data, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), profileId, 'cookie', Buffer.from(cookieJson), now);
    }
  });

  // ─── Extended Profile Data handlers ───
  ipcMain.handle('profile:saveExtendedData', async (_event, profileId: string, data: string) => {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM profile_data WHERE profile_id = ? AND data_type = ?')
      .get(profileId, 'localstorage') as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE profile_data SET data = ?, updated_at = ? WHERE id = ?')
        .run(Buffer.from(data), now, existing.id);
    } else {
      const crypto = require('crypto');
      db.prepare('INSERT INTO profile_data (id, profile_id, data_type, data, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), profileId, 'localstorage', Buffer.from(data), now);
    }
  });

  ipcMain.handle('profile:getExtendedData', async (_event, profileId: string) => {
    const row = db.prepare('SELECT data FROM profile_data WHERE profile_id = ? AND data_type = ?')
      .get(profileId, 'localstorage') as { data: Buffer | null } | undefined;
    if (!row || !row.data) return null;
    return row.data.toString('utf-8');
  });

  // ─── Group handlers ───
  ipcMain.handle('group:list', async () => {
    return db.prepare('SELECT * FROM groups ORDER BY name').all();
  });

  ipcMain.handle('group:create', async (_event, name: string, remark?: string) => {
    const crypto = require('crypto');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO groups (id, name, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, remark || null, now, now);
    return { id, name, remark: remark || null, created_at: now, updated_at: now };
  });

  ipcMain.handle('group:delete', async (_event, groupId: string) => {
    db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
  });

  ipcMain.handle('group:rename', async (_event, groupId: string, name: string) => {
    const now = new Date().toISOString();
    db.prepare('UPDATE groups SET name = ?, updated_at = ? WHERE id = ?').run(name, now, groupId);
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

  ipcMain.handle('proxy:updateStatus', async (_event, proxyId: string, status: string, responseTimeMs: number) => {
    const now = new Date().toISOString();
    db.prepare('UPDATE proxies SET status = ?, response_time_ms = ?, last_checked_at = ? WHERE id = ?')
      .run(status, responseTimeMs, now, proxyId);
  });

  /**
   * Check proxy connectivity and get geo info without saving to DB.
   * Supports HTTP, HTTPS, and SOCKS5 proxies by actually routing traffic through them.
   * Supports IP checker selection: ip-api.com, ipinfo.io, IP2Location.
   */
  ipcMain.handle('proxy:checkDirect', async (_event, config: ProxyConfig, ipChecker?: string) => {
    const http = await import('http');
    const net = await import('net');
    const start = Date.now();

    // Determine IP checker URL and response parser based on user selection
    const checker = (ipChecker || 'ip-api.com').toLowerCase();
    let checkerHost: string;
    let checkerPath: string;
    let parseResponse: (data: string) => { ip?: string; country?: string; region?: string; city?: string };

    if (checker.includes('ipinfo')) {
      checkerHost = 'ipinfo.io';
      checkerPath = '/json';
      parseResponse = (data: string) => {
        const json = JSON.parse(data);
        return { ip: json.ip, country: json.country, region: json.region, city: json.city };
      };
    } else if (checker.includes('ip2location')) {
      checkerHost = 'api.ip2location.io';
      checkerPath = '/';
      parseResponse = (data: string) => {
        const json = JSON.parse(data);
        return { ip: json.ip, country: json.country_name || json.country_code, region: json.region_name, city: json.city_name };
      };
    } else {
      // Default: ip-api.com
      checkerHost = 'ip-api.com';
      checkerPath = '/json/?fields=query,country,regionName,city,status';
      parseResponse = (data: string) => {
        const json = JSON.parse(data);
        if (json.status === 'success') {
          return { ip: json.query, country: json.country, region: json.regionName, city: json.city };
        }
        return { ip: json.query || 'Unknown' };
      };
    }

    const checkerUrl = `http://${checkerHost}${checkerPath}`;

    type CheckResult = {
      success: boolean;
      ip?: string;
      country?: string;
      region?: string;
      city?: string;
      responseTimeMs: number;
      error?: string;
    };

    /**
     * Makes an HTTP GET request over an already-connected socket and parses the geo response.
     */
    const httpGetOverSocket = (socket: import('net').Socket): Promise<CheckResult> => {
      return new Promise<CheckResult>((resolve) => {
        const timeout = setTimeout(() => {
          socket.destroy();
          resolve({ success: false, responseTimeMs: Date.now() - start, error: 'Timeout after 15s' });
        }, 15000);

        const reqStr = `GET ${checkerPath} HTTP/1.1\r\nHost: ${checkerHost}\r\nConnection: close\r\nAccept: application/json\r\n\r\n`;
        socket.write(reqStr);

        let rawData = '';
        socket.on('data', (chunk: Buffer) => { rawData += chunk.toString(); });
        socket.on('end', () => {
          clearTimeout(timeout);
          const elapsed = Date.now() - start;
          try {
            // Extract body from HTTP response (after \r\n\r\n)
            const bodyStart = rawData.indexOf('\r\n\r\n');
            const body = bodyStart >= 0 ? rawData.slice(bodyStart + 4) : rawData;
            // Handle chunked transfer encoding
            let jsonBody = body;
            if (rawData.toLowerCase().includes('transfer-encoding: chunked')) {
              // Parse chunked body: each chunk is "size\r\ndata\r\n"
              const chunks: string[] = [];
              let remaining = body;
              while (remaining.length > 0) {
                const lineEnd = remaining.indexOf('\r\n');
                if (lineEnd < 0) break;
                const chunkSize = parseInt(remaining.slice(0, lineEnd), 16);
                if (isNaN(chunkSize) || chunkSize === 0) break;
                chunks.push(remaining.slice(lineEnd + 2, lineEnd + 2 + chunkSize));
                remaining = remaining.slice(lineEnd + 2 + chunkSize + 2);
              }
              jsonBody = chunks.join('');
            }
            const geo = parseResponse(jsonBody.trim());
            resolve({ success: true, ...geo, responseTimeMs: elapsed });
          } catch {
            resolve({ success: true, ip: 'Connected (parse error)', responseTimeMs: elapsed });
          }
        });
        socket.on('error', (err: Error) => {
          clearTimeout(timeout);
          resolve({ success: false, responseTimeMs: Date.now() - start, error: err.message });
        });
      });
    };

    try {
      if (config.protocol === 'socks5') {
        // ─── SOCKS5 proxy connection ───
        const { SocksClient } = await import('socks');
        const socksOptions: import('socks').SocksClientOptions = {
          proxy: {
            host: config.host,
            port: config.port,
            type: 5,
            userId: config.username || undefined,
            password: config.password || undefined,
          },
          command: 'connect' as const,
          destination: {
            host: checkerHost,
            port: 80,
          },
          timeout: 15000,
        };

        const { socket } = await SocksClient.createConnection(socksOptions);
        return await httpGetOverSocket(socket);

      } else {
        // ─── HTTP/HTTPS proxy via CONNECT or direct GET ───
        return await new Promise<CheckResult>((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ success: false, responseTimeMs: Date.now() - start, error: 'Timeout after 15s' });
          }, 15000);

          // Connect to the proxy server
          const proxySocket = net.default.connect(config.port, config.host, () => {
            // For HTTP proxy, send the request directly through the proxy
            let reqStr = `GET ${checkerUrl} HTTP/1.1\r\nHost: ${checkerHost}\r\nConnection: close\r\nAccept: application/json\r\n`;
            // Add proxy authentication if provided
            if (config.username && config.password) {
              const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
              reqStr += `Proxy-Authorization: Basic ${auth}\r\n`;
            }
            reqStr += '\r\n';
            proxySocket.write(reqStr);
          });

          let rawData = '';
          proxySocket.on('data', (chunk: Buffer) => { rawData += chunk.toString(); });
          proxySocket.on('end', () => {
            clearTimeout(timeout);
            const elapsed = Date.now() - start;
            try {
              const bodyStart = rawData.indexOf('\r\n\r\n');
              const body = bodyStart >= 0 ? rawData.slice(bodyStart + 4) : rawData;
              let jsonBody = body;
              if (rawData.toLowerCase().includes('transfer-encoding: chunked')) {
                const chunks: string[] = [];
                let remaining = body;
                while (remaining.length > 0) {
                  const lineEnd = remaining.indexOf('\r\n');
                  if (lineEnd < 0) break;
                  const chunkSize = parseInt(remaining.slice(0, lineEnd), 16);
                  if (isNaN(chunkSize) || chunkSize === 0) break;
                  chunks.push(remaining.slice(lineEnd + 2, lineEnd + 2 + chunkSize));
                  remaining = remaining.slice(lineEnd + 2 + chunkSize + 2);
                }
                jsonBody = chunks.join('');
              }
              const geo = parseResponse(jsonBody.trim());
              resolve({ success: true, ...geo, responseTimeMs: elapsed });
            } catch {
              resolve({ success: true, ip: 'Connected (parse error)', responseTimeMs: elapsed });
            }
          });
          proxySocket.on('error', (err: Error) => {
            clearTimeout(timeout);
            resolve({ success: false, responseTimeMs: Date.now() - start, error: err.message });
          });
          proxySocket.setTimeout(15000, () => {
            proxySocket.destroy();
            clearTimeout(timeout);
            resolve({ success: false, responseTimeMs: Date.now() - start, error: 'Connection timeout' });
          });
        });
      }
    } catch (err: unknown) {
      return {
        success: false,
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
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

  return { profileManager };
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
