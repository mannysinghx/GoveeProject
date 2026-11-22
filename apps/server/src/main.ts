import { buildApp } from './app/build-app.js';
import { createPlatform } from './app/context.js';
import { ConfigError, isLoopbackHost, loadConfig, loadDotEnv } from './config/env.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const platform = createPlatform(config);
  const { logger, accounts } = platform;
  const owner = accounts.sole();

  logger.info(
    {
      version: platform.version,
      node: process.version,
      env: config.env,
      goveeKeyConfigured: owner.transport.isConfigured(),
      aiProviders: config.ai.enabled ? config.ai.providers.map((p) => `${p.id}:${p.model}`) : 'disabled',
      database: config.databasePath,
      accounts: accounts.all().length,
    },
    'Starting Govee Light Manager',
  );

  if (!owner.transport.isConfigured()) {
    logger.warn('GOVEE_API_KEY is not set. The app will start, but it cannot reach Govee until the key is set.');
  }
  if (config.govee.usingLocalTestEndpoint) {
    logger.warn({ baseUrl: config.govee.baseUrl }, 'Using a local test endpoint instead of the official Govee API');
  }

  if (!isLoopbackHost(config.host) && !config.allowedHosts) {
    logger.warn('Listening beyond loopback with no ALLOWED_HOSTS, so any Host header is accepted. See docs/security.md.');
  }

  accounts.recoverInterrupted();

  const app = await buildApp(platform);
  await app.listen({ host: config.host, port: config.port });

  if (platform.generatedSetupCode && platform.auth.setupRequired()) {
    // A one-time value for this process only, needed by whoever is setting up the app.
    // It stops working the moment an owner exists, and it is regenerated on restart.
    logger.warn(
      { setupCodeForFirstRun: platform.generatedSetupCode },
      'First-run setup may be reachable from other computers. Enter this code on the setup screen.',
    );
  }

  accounts.startAll();

  // Background work handles its own errors. Anything reaching here is a bug, so restart clean.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled rejection');
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const forced = setTimeout(() => {
      logger.error('Shutdown timed out');
      process.exit(1);
    }, 15_000);
    forced.unref();
    try {
      // The same order as always, for each account, with accounts stopping side by side.
      await accounts.stopBackground();
      await app.close();
      await accounts.stopCore();
      platform.control.close();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error('Failed to start:', error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
