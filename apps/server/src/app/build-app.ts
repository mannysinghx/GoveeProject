import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { ApiErrorBody } from '@glm/shared';
import { registerAccountRoutes } from '../account/account-routes.js';
import { registerActivityRoutes } from '../activity/activity-routes.js';
import { registerAiRoutes } from '../ai/ai-routes.js';
import { registerAdminRoutes } from '../auth/admin-routes.js';
import { registerAuthRoutes } from '../auth/auth-routes.js';
import { constantTimeEqual, type SessionInfo } from '../auth/auth-service.js';
import { SESSION_COOKIE } from '../auth/cookies.js';
import { isLoopbackHost } from '../config/env.js';
import { registerConnectionRoutes } from '../connection/connection-routes.js';
import { registerNotificationRoutes } from '../notifications/notification-routes.js';
import { registerDeviceRoutes } from '../devices/device-routes.js';
import { registerGroupRoutes } from '../groups/group-routes.js';
import { registerPresetRoutes } from '../presets/preset-routes.js';
import { registerScheduleRoutes } from '../scheduler/schedule-routes.js';
import { AppError } from '../shared/errors.js';
import { registerSystemRoutes } from '../system/system-routes.js';
import type { AccountContext, PlatformContext } from './context.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionInfo | null;
    /** The signed-in person's account. Read it with accountOf(request). */
    account: AccountContext | null;
  }
  interface FastifyInstance {
    /** Every route registered, as the route census test checks them. */
    routeTable: RouteEntry[];
  }
  interface FastifyContextConfig {
    /** Routes without this flag require a signed-in session. Secure by default. */
    public?: boolean;
    /** Only the owner may call this. Anyone else gets 404, as if it did not exist. */
    owner?: boolean;
    /** Skips the Host check. Only for the health route, which container health checks call by IP. */
    anyHost?: boolean;
  }
}

export interface RouteEntry {
  method: string;
  url: string;
  public: boolean;
  owner: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Loopback binds accept only loopback host names, which blocks DNS-rebinding attacks. */
function allowedHostSet(platform: PlatformContext): Set<string> | null {
  if (platform.config.allowedHosts) return new Set(platform.config.allowedHosts);
  if (isLoopbackHost(platform.config.host)) return new Set(['localhost', '127.0.0.1', '[::1]']);
  return null;
}

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const lower = hostHeader.toLowerCase();
  if (lower.startsWith('[')) return lower.slice(0, lower.indexOf(']') + 1);
  return lower.split(':')[0] ?? '';
}

function isApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  try {
    return decodeURIComponent(path).startsWith('/api/');
  } catch {
    return path.startsWith('/api/');
  }
}

function errorBody(request: FastifyRequest, code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, requestId: request.id, ...(details === undefined ? {} : { details }) } };
}

export async function buildApp(platform: PlatformContext): Promise<FastifyInstance> {
  const { config, logger } = platform;

  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    // A hop count, not Fastify's "true": with "true" the client-supplied left end of
    // X-Forwarded-For would become the client address, and forging it would defeat login throttling.
    trustProxy: config.trustProxy ? (_address: string, hop: number) => hop < config.trustProxyHops : false,
    bodyLimit: 256 * 1024,
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      return typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
    },
  });

  app.decorateRequest('session', null);
  app.decorateRequest('account', null);

  const routeTable: RouteEntry[] = [];
  app.decorate('routeTable', routeTable);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD') continue;
      if (route.config?.public === true && route.config?.owner === true) {
        throw new Error(`${method} ${route.url} cannot be both public and owner-only.`);
      }
      routeTable.push({ method, url: route.url, public: route.config?.public === true, owner: route.config?.owner === true });
    }
  });

  const allowedHosts = allowedHostSet(platform);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (request.routeOptions.config.anyHost) return;
    if (allowedHosts && !allowedHosts.has(hostnameOf(request.headers.host))) {
      throw new AppError(421, 'host_not_allowed', 'This address is not served here.');
    }
  });

  const secureContext = config.cookieSecure === true;
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // The colour picker injects a small style tag at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: secureContext,
    crossOriginOpenerPolicy: secureContext,
    originAgentCluster: secureContext,
  });
  await app.register(cookie);

  app.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.warn({ code: error.code }, error.message);
      } else if (error.statusCode !== 401) {
        request.log.info({ code: error.code, statusCode: error.statusCode }, 'Request rejected');
      }
      if (error.retryAfterSeconds !== undefined) reply.header('retry-after', String(error.retryAfterSeconds));
      void reply.status(error.statusCode).send(errorBody(request, error.code, error.message, error.details));
      return;
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status < 500) {
      void reply.status(status).send(errorBody(request, 'bad_request', 'The request could not be read.'));
      return;
    }
    request.log.error({ err: error }, 'Unhandled error');
    void reply
      .status(500)
      .send(errorBody(request, 'internal_error', 'Something went wrong. Please try again.'));
  });

  await app.register(
    async (api) => {
      // Default deny. This hook is attached to the routes in this plugin rather than
      // matching the URL text, so no spelling of a path (such as /%61pi/) can skip it.
      api.addHook('onRequest', async (request) => {
        request.session = platform.auth.validateSession(request.cookies[SESSION_COOKIE]);
        // The one place a session becomes an account. Public routes get one too when signed in.
        request.account = request.session ? platform.accounts.ensure(request.session.userId) : null;
        if (request.routeOptions.config.public) return;
        if (!request.session) {
          throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
        }
        if (request.routeOptions.config.owner && request.session.role !== 'owner') {
          throw new AppError(404, 'not_found', 'Not found.');
        }
        if (!request.account) {
          throw new AppError(503, 'account_unavailable', 'Your account is not available right now. Try again in a minute.');
        }
        // One member cannot hog the server. The owner has no limit, as before.
        if (request.session.role === 'member') {
          const wait = platform.requestRate.hit(request.session.userId, platform.clock.nowMs());
          if (wait > 0) throw new AppError(429, 'too_many_requests', 'Too many requests. Slow down and try again shortly.', undefined, wait);
        }
        if (MUTATING_METHODS.has(request.method)) {
          const header = request.headers['x-csrf-token'];
          if (typeof header !== 'string' || !constantTimeEqual(header, request.session.csrfToken)) {
            throw new AppError(403, 'csrf_failed', 'The security token is missing or out of date. Reload the page.');
          }
        }
      });

      // Each is given only the platform. Account services come from accountOf(request).
      registerAuthRoutes(api, platform);
      registerSystemRoutes(api, platform);
      registerDeviceRoutes(api);
      registerGroupRoutes(api);
      registerPresetRoutes(api);
      registerScheduleRoutes(api);
      registerActivityRoutes(api);
      registerConnectionRoutes(api);
      registerAiRoutes(api);
      registerNotificationRoutes(api, platform);
      registerAdminRoutes(api, platform);
      registerAccountRoutes(api, platform);
    },
    { prefix: '/api/v1' },
  );

  await registerFrontend(app, platform);
  return app;
}

/** Serves the built React app, so production runs on one origin with no CORS at all. */
async function registerFrontend(app: FastifyInstance, platform: PlatformContext): Promise<void> {
  const root = platform.config.webDistDir;
  const indexPath = path.join(root, 'index.html');
  const hasFrontend = fs.existsSync(indexPath);

  if (hasFrontend) {
    await app.register(fastifyStatic, {
      root,
      wildcard: false,
      setHeaders: (res, filePath) => {
        const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
        void res.header('cache-control', isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (isApiPath(request.url)) {
      // Signed-out callers cannot use this to find out which endpoints exist.
      if (!platform.auth.validateSession(request.cookies[SESSION_COOKIE])) {
        return reply.status(401).send(errorBody(request, 'unauthenticated', 'Sign in to continue.'));
      }
      return reply.status(404).send(errorBody(request, 'not_found', 'Not found.'));
    }
    // Page addresses get the app. A missing file gets a real 404, not HTML posing as a script.
    const isFile = /\.[a-z0-9]+$/i.test(request.url.split('?')[0] ?? '');
    if (hasFrontend && request.method === 'GET' && !isFile) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply
      .status(404)
      .send(errorBody(request, 'not_found', 'Not found.'));
  });
}
