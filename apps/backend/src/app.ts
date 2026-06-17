import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin, FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import fastify, { FastifyReply } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { env, isCloud } from './env';
import { AUTOMATION_JOB_NAME, automationHandler } from './handlers/automation.handler';
import {
	CONTEXT_RECOMMENDATIONS_JOB_NAME,
	contextRecommendationsHandler,
	ensureContextRecommendationsSchedules,
} from './handlers/context-recommendations.handler';
import { LOG_CLEANUP_JOB_NAME, logCleanupHandler, runLogCleanup } from './handlers/log-cleanup.handler';
import { MCP_QUERY_DATA_CLEANUP_JOB_NAME, mcpQueryDataCleanupHandler } from './handlers/mcp-query-data-cleanup.handler';
import { STORY_REFRESH_JOB_NAME, storyRefreshHandler } from './handlers/story-refresh.handler';
import { mcpServerRoutes } from './mcp/routes';
import { ensureOrganizationSetup } from './queries/organization.queries';
import { agentRoutes } from './routes/agent';
import { authRoutes } from './routes/auth';
import { authErrorRedirectRoutes } from './routes/auth-error-redirect';
import { brandingRoutes } from './routes/branding';
import { chartRoutes } from './routes/chart';
import { deployRoutes } from './routes/deploy';
import { embedStoryDownloadRoutes } from './routes/embed-story-download';
import { githubRoutes } from './routes/github';
import { imageRoutes } from './routes/image';
import { slackRoutes } from './routes/slack';
import { teamsRoutes } from './routes/teams';
import { telegramRoutes } from './routes/telegram';
import { testRoutes } from './routes/test';
import { whatsappRoutes } from './routes/whatsapp';
import { startLicenseHeartbeat } from './services/license.service';
import { logLicenseStatus } from './services/license-startup';
import { pingLicensesServer } from './services/ping';
import { posthog, PostHogEvent } from './services/posthog';
import { ensureRecurring, registerJob, startScheduler } from './services/scheduler.service';
import { slackService } from './services/slack';
import { TrpcRouter, trpcRouter } from './trpc/router';
import { createContext } from './trpc/trpc';
import { BudgetExceededError, HandlerError } from './utils/error';
import { logger } from './utils/logger';

// Get the directory of the current module (works in both dev and compiled)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = env.MODE !== 'prod';
// pino-pretty transport uses worker threads and can't be resolved inside a Bun-compiled binary.
// Unix path: /$bunfs/root/..., Windows path: B:/~BUN/root/...
const isCompiled = typeof Bun !== 'undefined' && /(\$bunfs|~BUN)/.test(Bun.main);

const app = fastify({
	logger:
		isDev && !isCompiled
			? {
					transport: {
						target: 'pino-pretty',
						options: {
							colorize: true,
							ignore: 'pid,hostname',
							translateTime: 'HH:MM:ss',
						},
					},
				}
			: true,
	bodyLimit: 35 * 1024 * 1024, // ~25 MB audio * 4/3 base64 overhead + JSON envelope
	routerOptions: { maxParamLength: 2048 },
	trustProxy: true,
}).withTypeProvider<ZodTypeProvider>();
export type App = typeof app;

// Set the validator and serializer compilers for the Zod type provider
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Map HandlerError to HTTP status code
app.setErrorHandler((error, request, reply) => {
	const message = error instanceof Error ? error.message : String(error);
	const statusCode =
		typeof (error as Record<string, unknown>).statusCode === 'number'
			? (error as Record<string, unknown>).statusCode
			: undefined;
	logger.error(message, {
		source: 'http',
		context: { method: request.method, url: request.url, statusCode },
	});
	if (error instanceof BudgetExceededError) {
		return reply.status(error.code).send({ error: error.message, code: 'BUDGET_EXCEEDED' });
	}
	if (error instanceof HandlerError) {
		return reply.status(error.code).send({ error: error.message });
	}
	throw error;
});

// Log HTTP requests to the database (skip log-polling to avoid self-referential noise)
app.addHook('onResponse', (request, reply, done) => {
	if (request.url.includes('log.listLogs')) {
		done();
		return;
	}
	if (reply.statusCode >= 400) {
		done();
		return;
	}
	logger.info(`${request.method} ${request.url} ${reply.statusCode}`, {
		source: 'http',
		context: { method: request.method, url: request.url, statusCode: reply.statusCode, elapsed: reply.elapsedTime },
	});
	done();
});

// Register raw body plugin for Slack signature verification
app.register(fastifyRawBody, {
	field: 'rawBody',
	global: false,
	runFirst: true,
});

// Register formbody plugin for Slack interaction payloads (application/x-www-form-urlencoded)
app.register(formbody);

// Register multipart plugin for file uploads (deploy endpoint)
app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

// Register tRPC plugin
app.register(fastifyTRPCPlugin, {
	prefix: '/api/trpc',
	trpcOptions: {
		router: trpcRouter,
		createContext,
		onError({ path, error }) {
			logger.error(`tRPC error on ${path}: ${error.message}`, {
				source: 'http',
				context: { path, code: error.code },
			});
		},
	} satisfies FastifyTRPCPluginOptions<TrpcRouter>['trpcOptions'],
});

app.register(agentRoutes, {
	prefix: '/api/agent',
});

app.register(testRoutes, {
	prefix: '/api/test',
});

app.register(chartRoutes, {
	prefix: '/c',
});

app.register(imageRoutes, {
	prefix: '/i',
});

app.register(brandingRoutes, {
	prefix: '/branding',
});

app.register(authErrorRedirectRoutes, {
	prefix: '/api',
});

app.register(embedStoryDownloadRoutes, {
	prefix: '/api/embed',
});

app.register(authRoutes, {
	prefix: '/api',
});

app.register(slackRoutes, {
	prefix: '/api/webhooks/slack',
});

app.register(teamsRoutes, {
	prefix: '/api/webhooks/teams',
});

app.register(telegramRoutes, {
	prefix: '/api/webhooks/telegram',
});

app.register(whatsappRoutes, {
	prefix: '/api/webhooks/whatsapp',
});

app.register(deployRoutes, {
	prefix: '/api',
});

app.register(githubRoutes, {
	prefix: '/api/github',
});

app.register(mcpServerRoutes, {
	prefix: '/mcp',
});

app.get('/.well-known/oauth-protected-resource', async (_request, reply) => {
	const { buildProtectedResourceMetadata } = await import('./auth');
	const { MCP_SERVER_URL } = await import('./env');
	const metadata = await buildProtectedResourceMetadata({ resource: MCP_SERVER_URL });
	reply
		.status(200)
		.header('Content-Type', 'application/json')
		.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=15, stale-if-error=86400')
		.send(metadata);
});

async function relayWebResponse(
	handler: (req: Request) => Promise<Response>,
	request: { url: string; headers: Record<string, string | string[] | undefined> },
	reply: FastifyReply,
) {
	const url = new URL(request.url, env.BETTER_AUTH_URL);
	const { convertHeaders } = await import('./utils/utils');
	const response = await handler(new Request(url, { method: 'GET', headers: convertHeaders(request.headers) }));
	reply.status(response.status);
	response.headers.forEach((value, key) => reply.header(key, value));
	reply.send(await response.text());
}

async function relayAuthServerMetadata(request: Parameters<typeof relayWebResponse>[1], reply: FastifyReply) {
	const { getAuthServerMetadataHandler } = await import('./auth');
	const handler = await getAuthServerMetadataHandler();
	await relayWebResponse(handler, request, reply);
}

async function relayOpenIdConfigMetadata(request: Parameters<typeof relayWebResponse>[1], reply: FastifyReply) {
	const { getOpenIdConfigMetadataHandler } = await import('./auth');
	const handler = await getOpenIdConfigMetadataHandler();
	await relayWebResponse(handler, request, reply);
}

app.get('/.well-known/oauth-authorization-server/api/auth', relayAuthServerMetadata);
app.get('/.well-known/openid-configuration/api/auth', relayOpenIdConfigMetadata);
app.get('/api/auth/.well-known/openid-configuration', relayOpenIdConfigMetadata);
app.get('/.well-known/oauth-authorization-server', relayAuthServerMetadata);
app.get('/.well-known/openid-configuration', relayOpenIdConfigMetadata);

/**
 * Tests the API connection
 */
app.get('/api', async () => {
	return 'Welcome to the API!';
});

// Serve frontend static files in production
// Look for frontend dist in multiple possible locations
const execDir = dirname(process.execPath); // Directory containing the compiled binary
const possibleStaticPaths = [
	join(execDir, 'public'), // Bun compiled: public folder next to binary
	join(__dirname, 'public'), // When bundled: public folder next to compiled code
	join(__dirname, '../public'), // Alternative bundled location
	join(__dirname, '../../frontend/dist'), // Development: relative to backend src
];

const staticRoot = possibleStaticPaths.find((p) => existsSync(p));
const isReservedBackendPath = (url: string) => {
	const pathname = url.split('?', 1)[0];
	return (
		pathname === '/api' ||
		pathname.startsWith('/api/') ||
		pathname === '/c' ||
		pathname.startsWith('/c/') ||
		pathname === '/i' ||
		pathname.startsWith('/i/') ||
		pathname === '/branding' ||
		pathname.startsWith('/branding/') ||
		pathname === '/mcp' ||
		pathname.startsWith('/mcp/') ||
		pathname.startsWith('/.well-known/')
	);
};

console.log('Static root:', staticRoot || 'Not found (API-only mode)');

if (staticRoot) {
	app.register(fastifyStatic, {
		root: staticRoot,
		prefix: '/',
		wildcard: false,
	});

	// SPA fallback: serve index.html for all non-API routes
	app.setNotFoundHandler((request, reply) => {
		if (isReservedBackendPath(request.url)) {
			reply.status(404).send({ error: 'Not found' });
		} else {
			reply.sendFile('index.html');
		}
	});
}

export const startServer = async (opts: { port: number; host: string }) => {
	if (isCloud) {
		// TODO: Implement cloud mode
	} else {
		await ensureOrganizationSetup();
	}
	await logLicenseStatus();

	void runLogCleanup().catch((err) => {
		logger.error(`Log cleanup failed: ${err instanceof Error ? err.message : String(err)}`, { source: 'system' });
	});

	registerJob(LOG_CLEANUP_JOB_NAME, logCleanupHandler);
	await ensureRecurring({ name: LOG_CLEANUP_JOB_NAME, cron: '0 3 * * *', uniqueKey: LOG_CLEANUP_JOB_NAME });

	registerJob(AUTOMATION_JOB_NAME, automationHandler);
	registerJob(STORY_REFRESH_JOB_NAME, storyRefreshHandler);

	registerJob(MCP_QUERY_DATA_CLEANUP_JOB_NAME, mcpQueryDataCleanupHandler);
	await ensureRecurring({
		name: MCP_QUERY_DATA_CLEANUP_JOB_NAME,
		cron: '0 4 * * *',
		uniqueKey: MCP_QUERY_DATA_CLEANUP_JOB_NAME,
	});

	if (env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED) {
		registerJob(CONTEXT_RECOMMENDATIONS_JOB_NAME, contextRecommendationsHandler);
		try {
			await ensureContextRecommendationsSchedules();
		} catch (err) {
			logger.error(
				`Failed to register context recommendations schedules: ${err instanceof Error ? err.message : String(err)}`,
				{ source: 'system' },
			);
		}
	}

	startScheduler();
	await startLicenseHeartbeat();

	const address = await app.listen({ host: opts.host, port: opts.port });
	app.log.info(`Server is running on ${address}`);

	void pingLicensesServer();
	void slackService.startSocketModeForAllProjects();

	posthog.capture(undefined, PostHogEvent.ServerStarted, { ...opts, address });

	const handleShutdown = async () => {
		await posthog.shutdown();
		process.exit(0);
	};

	process.on('SIGINT', handleShutdown);
	process.on('SIGTERM', handleShutdown);
};

export default app;
