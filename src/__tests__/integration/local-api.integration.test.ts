/**
 * Integration Test: Local API Endpoints
 *
 * Tests the Local API server with supertest:
 * - Start the API server
 * - Test all endpoints (open, close, list profiles)
 * - Verify API key authentication
 * - Verify error responses
 *
 * Task 14.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { initializeDatabase } from '../../main/database/index';
import { ProfileManager } from '../../main/services/profile-manager/profile-manager';
import { LocalAPIServer } from '../../main/services/local-api/local-api-server';
import type { ProfileConfig } from '../../shared/types';

// Mock Playwright
vi.mock('playwright', () => {
  const mockBrowserServer = {
    wsEndpoint: () => 'ws://127.0.0.1:9222/devtools/browser/api-test',
    close: vi.fn(async () => {}),
  };
  return {
    chromium: { launchServer: vi.fn(async () => mockBrowserServer) },
    firefox: { launchServer: vi.fn(async () => mockBrowserServer) },
  };
});

const API_KEY = 'integration-test-api-key';

describe('Integration: Local API Endpoints', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let profileManager: ProfileManager;
  let apiServer: LocalAPIServer;
  const ownerId = 'api-test-owner';

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dbPath = path.join(os.tmpdir(), `test-local-api-${suffix}.db`);
    basePath = path.join(os.tmpdir(), `test-profiles-api-${suffix}`);
    fs.mkdirSync(basePath, { recursive: true });

    db = initializeDatabase(dbPath);

    // Insert test user
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, api_key, created_at, updated_at)
       VALUES (?, 'apiuser', 'hash', 'admin', ?, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId, API_KEY);

    profileManager = new ProfileManager(db, basePath);
    apiServer = new LocalAPIServer(profileManager, API_KEY);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
    try { fs.rmSync(basePath, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // --- API Key Authentication ---

  describe('API key authentication', () => {
    it('should reject requests without API key', async () => {
      const res = await request(apiServer.getApp())
        .get('/api/v1/profiles')
        .expect(401);

      expect(res.body.error).toContain('Unauthorized');
    });

    it('should reject requests with wrong API key', async () => {
      const res = await request(apiServer.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', 'wrong-key')
        .expect(401);

      expect(res.body.error).toContain('Unauthorized');
    });

    it('should accept requests with valid API key', async () => {
      const res = await request(apiServer.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // --- GET /api/v1/profiles ---

  describe('GET /api/v1/profiles', () => {
    it('should return empty array when no profiles exist', async () => {
      const res = await request(apiServer.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return all profiles with status info', async () => {
      // Create two profiles
      const config: ProfileConfig = {
        name: 'API Profile 1',
        browserType: 'chromium',
        fingerprint: {
          canvas: { noiseLevel: 0.5 },
          webgl: { noiseLevel: 0.3 },
          audioContext: { frequencyOffset: 0.01 },
          cpu: { cores: 4 },
          ram: { sizeGB: 8 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          fonts: ['Arial'],
          webrtc: 'disable',
          platform: 'Win32',
          appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
          oscpu: 'Windows NT 10.0',
        },
      };

      await profileManager.createProfile(config, ownerId);
      await profileManager.createProfile(
        { ...config, name: 'API Profile 2', browserType: 'firefox' },
        ownerId,
      );

      const res = await request(apiServer.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('name');
      expect(res.body[0]).toHaveProperty('status');
      expect(res.body[0]).toHaveProperty('browserType');
    });
  });

  // --- POST /api/v1/profiles/:id/open ---

  describe('POST /api/v1/profiles/:id/open', () => {
    it('should open a profile and return wsEndpoint', async () => {
      const config: ProfileConfig = {
        name: 'Open Test',
        browserType: 'chromium',
        fingerprint: {
          canvas: { noiseLevel: 0.5 },
          webgl: { noiseLevel: 0.3 },
          audioContext: { frequencyOffset: 0.01 },
          cpu: { cores: 4 },
          ram: { sizeGB: 8 },
          userAgent: 'Mozilla/5.0',
          fonts: ['Arial'],
          webrtc: 'disable',
          platform: 'Win32',
          appVersion: '5.0',
          oscpu: 'Windows NT 10.0',
        },
      };
      const profile = await profileManager.createProfile(config, ownerId);

      const res = await request(apiServer.getApp())
        .post(`/api/v1/profiles/${profile.id}/open`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body.wsEndpoint).toBeDefined();
      expect(res.body.profileId).toBe(profile.id);

      // Clean up
      await profileManager.closeProfile(profile.id);
    });

    it('should return 404 for non-existent profile', async () => {
      const res = await request(apiServer.getApp())
        .post('/api/v1/profiles/non-existent-id/open')
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(res.body.error).toContain('Profile not found');
    });

    it('should return 409 when profile is already open', async () => {
      const config: ProfileConfig = {
        name: 'Already Open',
        browserType: 'chromium',
        fingerprint: {
          canvas: { noiseLevel: 0.5 },
          webgl: { noiseLevel: 0.3 },
          audioContext: { frequencyOffset: 0.01 },
          cpu: { cores: 4 },
          ram: { sizeGB: 8 },
          userAgent: 'Mozilla/5.0',
          fonts: ['Arial'],
          webrtc: 'disable',
          platform: 'Win32',
          appVersion: '5.0',
          oscpu: 'Windows NT 10.0',
        },
      };
      const profile = await profileManager.createProfile(config, ownerId);

      // Open once
      await request(apiServer.getApp())
        .post(`/api/v1/profiles/${profile.id}/open`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      // Try to open again
      const res = await request(apiServer.getApp())
        .post(`/api/v1/profiles/${profile.id}/open`)
        .set('X-API-Key', API_KEY)
        .expect(409);

      expect(res.body.error).toContain('already open');

      // Clean up
      await profileManager.closeProfile(profile.id);
    });
  });

  // --- POST /api/v1/profiles/:id/close ---

  describe('POST /api/v1/profiles/:id/close', () => {
    it('should close an open profile', async () => {
      const config: ProfileConfig = {
        name: 'Close Test',
        browserType: 'chromium',
        fingerprint: {
          canvas: { noiseLevel: 0.5 },
          webgl: { noiseLevel: 0.3 },
          audioContext: { frequencyOffset: 0.01 },
          cpu: { cores: 4 },
          ram: { sizeGB: 8 },
          userAgent: 'Mozilla/5.0',
          fonts: ['Arial'],
          webrtc: 'disable',
          platform: 'Win32',
          appVersion: '5.0',
          oscpu: 'Windows NT 10.0',
        },
      };
      const profile = await profileManager.createProfile(config, ownerId);

      // Open first
      await profileManager.openProfile(profile.id);

      // Close via API
      const res = await request(apiServer.getApp())
        .post(`/api/v1/profiles/${profile.id}/close`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body.message).toBe('Profile closed');
    });

    it('should return 404 for non-existent profile', async () => {
      const res = await request(apiServer.getApp())
        .post('/api/v1/profiles/non-existent-id/close')
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(res.body.error).toContain('Profile not found');
    });
  });

  // --- Error responses ---

  describe('error responses', () => {
    it('should return proper error format with error and code fields', async () => {
      const res = await request(apiServer.getApp())
        .post('/api/v1/profiles/bad-id/open')
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('code');
      expect(typeof res.body.error).toBe('string');
      expect(typeof res.body.code).toBe('number');
    });
  });
});
