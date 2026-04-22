/**
 * Local API Server
 *
 * HTTP server trên cổng 5015 cho tích hợp automation bên ngoài.
 * Cung cấp REST API để mở/đóng hồ sơ trình duyệt, liệt kê hồ sơ,
 * và xác thực qua API key.
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import type { Server } from 'http';
import type { ProfileManager } from '../profile-manager/profile-manager';
import { AppErrorCode } from '../../../shared/types';

/** Default port for the Local API Server. */
const DEFAULT_PORT = 5015;

/**
 * Custom application error with an AppErrorCode.
 */
interface AppError extends Error {
  code: number;
}

/**
 * Maps AppErrorCode values to HTTP status codes.
 */
function mapErrorCodeToHttpStatus(code: number): number {
  switch (code) {
    case AppErrorCode.PROFILE_NOT_FOUND:
      return 404;
    case AppErrorCode.PROFILE_ALREADY_OPEN:
      return 409;
    case AppErrorCode.INVALID_API_KEY:
      return 401;
    case AppErrorCode.ACCESS_DENIED:
      return 403;
    default:
      return 500;
  }
}

export class LocalAPIServer {
  private app: express.Application;
  private server: Server | null = null;
  private profileManager: ProfileManager;
  private apiKey: string;

  /**
   * @param profileManager - ProfileManager instance for profile operations.
   * @param apiKey - Valid API key required for authentication.
   */
  constructor(profileManager: ProfileManager, apiKey: string) {
    this.profileManager = profileManager;
    this.apiKey = apiKey;
    this.app = express();

    this.app.use(express.json());
    this.setupRoutes();
    this.setupErrorHandler();
  }

  /**
   * Returns the Express application instance (useful for testing with supertest).
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Starts the HTTP server on the specified port.
   * @param port - Port number (defaults to 5015).
   */
  async start(port: number = DEFAULT_PORT): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, () => {
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  /**
   * Stops the HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Sets up API key authentication middleware and route handlers.
   */
  private setupRoutes(): void {
    const router = Router();

    // API key authentication middleware for all /api/v1/ routes
    router.use(this.authenticateApiKey.bind(this));

    // POST /api/v1/profiles/:id/open — open a profile
    router.post('/profiles/:id/open', this.openProfile.bind(this));

    // POST /api/v1/profiles/:id/close — close a profile
    router.post('/profiles/:id/close', this.closeProfile.bind(this));

    // GET /api/v1/profiles — list all profiles
    router.get('/profiles', this.listProfiles.bind(this));

    this.app.use('/api/v1', router);
  }

  /**
   * Sets up the global error handling middleware.
   */
  private setupErrorHandler(): void {
    this.app.use(
      (err: AppError, _req: Request, res: Response, _next: NextFunction) => {
        const code = err.code;
        const httpStatus = typeof code === 'number' ? mapErrorCodeToHttpStatus(code) : 500;
        res.status(httpStatus).json({
          error: err.message || 'Internal server error',
          code: httpStatus,
        });
      },
    );
  }

  /**
   * Middleware: validates the X-API-Key header.
   */
  private authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
    const providedKey = req.headers['x-api-key'] as string | undefined;

    if (!providedKey || providedKey !== this.apiKey) {
      res.status(401).json({
        error: 'Unauthorized: invalid or missing API key',
        code: 401,
      });
      return;
    }

    next();
  }

  /**
   * POST /api/v1/profiles/:id/open
   * Opens a browser profile and returns the WebSocket endpoint.
   */
  private async openProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const connection = await this.profileManager.openProfile(id);
      res.status(200).json({
        wsEndpoint: connection.wsEndpoint,
        profileId: connection.profileId,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/profiles/:id/close
   * Closes a browser profile and saves its state.
   */
  private async closeProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await this.profileManager.closeProfile(id);
      res.status(200).json({ message: 'Profile closed' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/profiles
   * Returns a list of all profiles with their status.
   */
  private async listProfiles(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profiles = await this.profileManager.listProfiles();
      res.status(200).json(profiles);
    } catch (err) {
      next(err);
    }
  }
}
