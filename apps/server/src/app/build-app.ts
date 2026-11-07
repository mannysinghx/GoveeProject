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
import { registerActivityRoutes } from '../activity/activity-routes.js';
import { registerAuthRoutes } from '../auth/auth-routes.js';
import { constantTimeEqual, type SessionInfo } from '../auth/auth-service.js';
import { SESSION_COOKIE } from '../auth/cookies.js';
import { isLoopbackHost } from '../config/env.js';
import { registerDeviceRoutes } from '../devices/device-routes.js';
import { registerGroupRoutes } from '../groups/group-routes.js';
import { registerPresetRoutes } from '../presets/preset-routes.js';
import { registerScheduleRoutes } from '../scheduler/schedule-routes.js';
import { AppError } from '../shared/errors.js';
import { registerSystemRoutes } from '../system/system-routes.js';
import type { AppContext } from './context.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionInfo | null;
  }
  interface FastifyContextConfig {
    /** Routes without this flag require a signed-in session. Secure by default. */
    public?: boolean;
    /** Skips the Host check. Only for the health route, which container health checks call by IP. */
    anyHost?: boolean;
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Loopback binds accept only loopback host names, which blocks DNS-rebinding attacks. */
function allowedHostSet(ctx: AppContext): Set<string> | null {
  if (ctx.config.allowedHosts) return new Set(ctx.config.allowedHosts);
  if (isLoopbackHost(ctx.config.host)) return new Set(['localhost', '127.0.0.1', '[::1]']);
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

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { config, logger } = ctx;

  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    // One hop, not "true": with "true" the client-supplied left end of X-Forwarded-For
    // would become the client address, and forging it would defeat login throttling.
    trustProxy: config.trustProxy ? (_address: string, hop: number) => hop < 1 : false,
    bodyLimit: 256 * 1024,
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      return typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
    },
  });

  app.decorateRequest('session', null);

  const allowedHosts = allowedHostSet(ctx);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (request.routeOptions.config.anyHost) return;
    if (allowedHosts && !allowedHosts.has(hostnameOf(request.headers.host))) {
      throw new AppError(421, 'host_not_allowed', 'This host name is not allowed. Set ALLOWED_HOSTS on the server.');
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
      .send(errorBody(request, 'internal_error', 'Something went wrong on the server. See the server log.'));
  });

  await app.register(
    async (api) => {
      // Default deny. This hook is attached to the routes in this plugin rather than
      // matching the URL text, so no spelling of a path (such as /%61pi/) can skip it.
      api.addHook('onRequest', async (request) => {
        request.session = ctx.auth.validateSession(request.cookies[SESSION_COOKIE]);
        if (request.routeOptions.config.public) return;
        if (!request.session) {
          throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
        }
        if (MUTATING_METHODS.has(request.method)) {
          const header = request.headers['x-csrf-token'];
          if (typeof header !== 'string' || !constantTimeEqual(header, request.session.csrfToken)) {
            throw new AppError(403, 'csrf_failed', 'The security token is missing or out of date. Reload the page.');
          }
        }
      });

      registerAuthRoutes(api, ctx);
      registerSystemRoutes(api, ctx);
      registerDeviceRoutes(api, ctx);
      registerGroupRoutes(api, ctx);
      registerPresetRoutes(api, ctx);
      registerScheduleRoutes(api, ctx);
      registerActivityRoutes(api, ctx);
    },
    { prefix: '/api/v1' },
  );

  await registerFrontend(app, ctx);
  return app;
}

/** Serves the built React app, so production runs on one origin with no CORS at all. */
async function registerFrontend(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const root = ctx.config.webDistDir;
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
      if (!ctx.auth.validateSession(request.cookies[SESSION_COOKIE])) {
        return reply.status(401).send(errorBody(request, 'unauthenticated', 'Sign in to continue.'));
      }
      return reply.status(404).send(errorBody(request, 'not_found', 'That endpoint does not exist.'));
    }
    if (hasFrontend && request.method === 'GET') {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply
      .status(404)
      .send(errorBody(request, 'not_found', hasFrontend ? 'Not found.' : 'The web app has not been built. Run npm run build.'));
  });
}
