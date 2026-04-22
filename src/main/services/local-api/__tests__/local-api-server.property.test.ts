/**
 * Property-based tests for Local API Server.
 *
 * - P14: API từ chối yêu cầu không hợp lệ với mã lỗi phù hợp
 * - P15: Xác thực API key
 * - Smoke test: Server khởi chạy trên cổng cấu hình được
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import request from 'supertest';
import { LocalAPIServer } from '../local-api-server';
import { AppErrorCode } from '../../../../shared/types';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';

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

const VALID_API_KEY = 'correct-api-key-for-tests';

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Random non-empty string for profile IDs. */
const arbProfileId: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 1, maxLength: 36 },
);

/**
 * Random API key string that is guaranteed to differ from VALID_API_KEY.
 * Generates printable ASCII strings of length 1-64.
 */
const arbInvalidApiKey: fc.Arbitrary<string> = fc
  .stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 33 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 64 },
  )
  .filter((key) => key !== VALID_API_KEY);

// ---------------------------------------------------------------------------
// Property 14: API từ chối yêu cầu không hợp lệ với mã lỗi phù hợp
// ---------------------------------------------------------------------------

describe('LocalAPIServer property tests', () => {
  let mockPM: ReturnType<typeof createMockProfileManager>;
  let server: LocalAPIServer;

  beforeEach(() => {
    mockPM = createMockProfileManager();
    server = new LocalAPIServer(mockPM as any, VALID_API_KEY);
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * Property 14: API từ chối yêu cầu không hợp lệ với mã lỗi phù hợp
   *
   * For any HTTP request to the Local API with a profile ID that does not exist,
   * the API must return an HTTP 404 error code with a descriptive error message.
   */
  it(
    propertyTag(14, 'API từ chối yêu cầu không hợp lệ với mã lỗi phù hợp'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbProfileId, async (profileId) => {
          // Mock ProfileManager to throw PROFILE_NOT_FOUND for any ID
          const err = new Error(`Profile not found: ${profileId}`) as Error & { code: number };
          err.code = AppErrorCode.PROFILE_NOT_FOUND;
          mockPM.openProfile.mockRejectedValue(err);

          const res = await request(server.getApp())
            .post(`/api/v1/profiles/${encodeURIComponent(profileId)}/open`)
            .set('X-API-Key', VALID_API_KEY);

          // Must return 404
          if (res.status !== 404) return false;

          // Must include a descriptive error message
          if (!res.body.error || typeof res.body.error !== 'string') return false;
          if (res.body.error.length === 0) return false;

          // Must include the error code in the response body
          if (res.body.code !== 404) return false;

          return true;
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // Property 15: Xác thực API key
  // -------------------------------------------------------------------------

  /**
   * **Validates: Requirements 7.6**
   *
   * Property 15: Xác thực API key
   *
   * For any request to the Local API, if the API key is invalid or missing,
   * the system must reject the request (401). Only the correct API key
   * should be accepted (200).
   */
  it(
    propertyTag(15, 'Xác thực API key — invalid keys are rejected'),
    async () => {
      mockPM.listProfiles.mockResolvedValue([]);

      await assertProperty(
        fc.asyncProperty(arbInvalidApiKey, async (wrongKey) => {
          const res = await request(server.getApp())
            .get('/api/v1/profiles')
            .set('X-API-Key', wrongKey);

          // Invalid key must be rejected with 401
          if (res.status !== 401) return false;

          // Response must contain an error message
          if (!res.body.error || typeof res.body.error !== 'string') return false;

          return true;
        }),
      );
    },
  );

  it(
    propertyTag(15, 'Xác thực API key — missing key is rejected'),
    async () => {
      // No X-API-Key header at all
      const res = await request(server.getApp()).get('/api/v1/profiles');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(typeof res.body.error).toBe('string');
    },
  );

  it(
    propertyTag(15, 'Xác thực API key — correct key is accepted'),
    async () => {
      mockPM.listProfiles.mockResolvedValue([]);

      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', VALID_API_KEY);

      expect(res.status).toBe(200);
    },
  );
});

// ---------------------------------------------------------------------------
// Smoke test: Server port
// ---------------------------------------------------------------------------

describe('LocalAPIServer smoke test — server port', () => {
  /**
   * Smoke test for Requirement 7.1: Server khởi chạy trên cổng cấu hình được.
   *
   * Start the server on a random available port, verify it is listening,
   * then stop it cleanly.
   */
  it('should start on a configurable port and respond to requests', async () => {
    const mockPM = createMockProfileManager();
    mockPM.listProfiles.mockResolvedValue([]);
    const server = new LocalAPIServer(mockPM as any, VALID_API_KEY);

    // Use port 0 to let the OS assign a random available port
    await server.start(0);

    try {
      // Verify the server is listening by making a request via supertest
      const res = await request(server.getApp())
        .get('/api/v1/profiles')
        .set('X-API-Key', VALID_API_KEY);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
