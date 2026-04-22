/**
 * Unit tests for LocalAPIServer.
 *
 * Tests cover:
 * - Express HTTP server setup
 * - API key authentication middleware (X-API-Key header)
 * - POST /api/v1/profiles/:id/open — open profile, return WebSocket endpoint
 * - POST /api/v1/profiles/:id/close — close profile, save state
 * - GET /api/v1/profiles — list profiles with status
 * - Error handling middleware — return appropriate HTTP error codes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { LocalAPIServer } from '../local-api-server';
import { AppErrorCode } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Mock ProfileManager
// ---------------------------------------------------------------------------

function createMockProfileManager() {
  return {
    openProfile: vi.fn(),
    closeProfile: vi.fn(),
    listProfiles: vi.fn(),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    updateProfile: vi.fn(),
    isProfileOpen: vi.fn(),
    getProfileDir: vi.fn(),
  };
}

const API_KEY = 'test-api-key-12345';

describe('LocalAPIServer', () => {
  let mockPM: ReturnType<typeof createMockProfileManager>;
  let server: LocalAPIServer;

  beforeEach(() => {
    mockPM = createMockProfileManager();
    server = new LocalAPIServer(mockPM as any, API_KEY);
  });

  // -----------------------------------------------------------------------
  // Task 6.1 — Express HTTP server on port 5015
  // -----------------------------------------------------------------------
  describe('server lifecycle', () => {
    it('should start on the default port 5015 and stop cleanly', async () => {
      await server.start(0); // use port 0 for random available port in tests
      await server.stop();
    });

    it('should stop gracefully even if not started', async () => {
      await server.stop(); // should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Task 6.2 — API key authentication middleware
  // -----------------------------------------------------------------------
  describe('API key authentication', () => {
    it('should return 401 when X-API-Key header is missing', async () => {
      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .expect(401);

      expect(res.body.error).toContain('Unauthorized');
      expect(res.body.code).toBe(401);
    });

    it('should return 401 when X-API-Key header is invalid', async () => {
      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', 'wrong-key')
        .expect(401);

      expect(res.body.error).toContain('Unauthorized');
      expect(res.body.code).toBe(401);
    });

    it('should allow requests with a valid API key', async () => {
      mockPM.listProfiles.mockResolvedValue([]);

      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Task 6.3 — POST /api/v1/profiles/:id/open
  // -----------------------------------------------------------------------
  describe('POST /api/v1/profiles/:id/open', () => {
    it('should return 200 with wsEndpoint and profileId on success', async () => {
      mockPM.openProfile.mockResolvedValue({
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
        profileId: 'profile-1',
      });

      const res = await request(server.getApp())
        .post('/api/v1/profiles/profile-1/open')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body).toEqual({
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
        profileId: 'profile-1',
      });
      expect(mockPM.openProfile).toHaveBeenCalledWith('profile-1');
    });

    it('should return 404 when profile is not found', async () => {
      const err = new Error('Profile not found: unknown-id') as Error & { code: number };
      err.code = AppErrorCode.PROFILE_NOT_FOUND;
      mockPM.openProfile.mockRejectedValue(err);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/unknown-id/open')
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(res.body.error).toContain('Profile not found');
      expect(res.body.code).toBe(404);
    });

    it('should return 409 when profile is already open', async () => {
      const err = new Error('Profile is already open: profile-1') as Error & { code: number };
      err.code = AppErrorCode.PROFILE_ALREADY_OPEN;
      mockPM.openProfile.mockRejectedValue(err);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/profile-1/open')
        .set('X-API-Key', API_KEY)
        .expect(409);

      expect(res.body.error).toContain('already open');
      expect(res.body.code).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // Task 6.4 — POST /api/v1/profiles/:id/close
  // -----------------------------------------------------------------------
  describe('POST /api/v1/profiles/:id/close', () => {
    it('should return 200 with success message on close', async () => {
      mockPM.closeProfile.mockResolvedValue(undefined);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/profile-1/close')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body).toEqual({ message: 'Profile closed' });
      expect(mockPM.closeProfile).toHaveBeenCalledWith('profile-1');
    });

    it('should return 404 when closing a non-existent profile', async () => {
      const err = new Error('Profile not found: unknown-id') as Error & { code: number };
      err.code = AppErrorCode.PROFILE_NOT_FOUND;
      mockPM.closeProfile.mockRejectedValue(err);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/unknown-id/close')
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(res.body.error).toContain('Profile not found');
      expect(res.body.code).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Task 6.5 — GET /api/v1/profiles
  // -----------------------------------------------------------------------
  describe('GET /api/v1/profiles', () => {
    it('should return 200 with an array of profile summaries', async () => {
      const profiles = [
        {
          id: 'p1',
          name: 'Profile 1',
          status: 'open',
          browserType: 'chromium',
          proxyAssigned: null,
          lastUsedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'p2',
          name: 'Profile 2',
          status: 'closed',
          browserType: 'firefox',
          proxyAssigned: 'proxy-1',
          lastUsedAt: null,
        },
      ];
      mockPM.listProfiles.mockResolvedValue(profiles);

      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body).toEqual(profiles);
      expect(mockPM.listProfiles).toHaveBeenCalled();
    });

    it('should return 200 with empty array when no profiles exist', async () => {
      mockPM.listProfiles.mockResolvedValue([]);

      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Task 6.6 — Error handling middleware
  // -----------------------------------------------------------------------
  describe('error handling middleware', () => {
    it('should map PROFILE_NOT_FOUND to 404', async () => {
      const err = new Error('Not found') as Error & { code: number };
      err.code = AppErrorCode.PROFILE_NOT_FOUND;
      mockPM.openProfile.mockRejectedValue(err);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/x/open')
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(res.body.code).toBe(404);
    });

    it('should map PROFILE_ALREADY_OPEN to 409', async () => {
      const err = new Error('Already open') as Error & { code: number };
      err.code = AppErrorCode.PROFILE_ALREADY_OPEN;
      mockPM.openProfile.mockRejectedValue(err);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/x/open')
        .set('X-API-Key', API_KEY)
        .expect(409);

      expect(res.body.code).toBe(409);
    });

    it('should map INVALID_API_KEY to 401', async () => {
      const err = new Error('Bad key') as Error & { code: number };
      err.code = AppErrorCode.INVALID_API_KEY;
      mockPM.closeProfile.mockRejectedValue(err);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/x/close')
        .set('X-API-Key', API_KEY)
        .expect(401);

      expect(res.body.code).toBe(401);
    });

    it('should map ACCESS_DENIED to 403', async () => {
      const err = new Error('Forbidden') as Error & { code: number };
      err.code = AppErrorCode.ACCESS_DENIED;
      mockPM.closeProfile.mockRejectedValue(err);

      const res = await request(server.getApp())
        .post('/api/v1/profiles/x/close')
        .set('X-API-Key', API_KEY)
        .expect(403);

      expect(res.body.code).toBe(403);
    });

    it('should return 500 for unknown error codes', async () => {
      const err = new Error('Something broke') as Error & { code: number };
      err.code = 9999;
      mockPM.listProfiles.mockRejectedValue(err);

      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(res.body.code).toBe(500);
      expect(res.body.error).toBe('Something broke');
    });

    it('should return 500 for errors without a code', async () => {
      mockPM.listProfiles.mockRejectedValue(new Error('Unexpected'));

      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(res.body.code).toBe(500);
    });
  });
});
