import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin, FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import fastify from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { slackRoutes } from './routes/slack';
import { TrpcRouter, trpcRouter } from './trpc/router';
import { createContext } from './trpc/trpc';

// Get the directory of the current module (works in both dev and compiled)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = fastify({
	logger: true,
	routerOptions: { maxParamLength: 2048 },
}).withTypeProvider<ZodTypeProvider>();
export type App = typeof app;

// Set the validator and serializer compilers for the Zod type provider
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Register raw body plugin for Slack signature verification
app.register(fastifyRawBody, {
	field: 'rawBody',
	global: false,
	runFirst: true,
});

// Register formbody plugin for Slack interaction payloads (application/x-www-form-urlencoded)
app.register(formbody);

// Register tRPC plugin
app.register(fastifyTRPCPlugin, {
	prefix: '/api/trpc',
	trpcOptions: {
		router: trpcRouter,
		createContext,
		onError({ path, error }) {
			console.error(`Error in tRPC handler on path '${path}':\n`, error);
		},
	} satisfies FastifyTRPCPluginOptions<TrpcRouter>['trpcOptions'],
});

app.register(chatRoutes, {
	prefix: '/api/chat',
});

app.register(authRoutes, {
	prefix: '/api',
});

app.register(slackRoutes, {
	prefix: '/api/slack/events',
});

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
console.log('Static root:', staticRoot || 'Not found (API-only mode)');

if (staticRoot) {
	app.register(fastifyStatic, {
		root: staticRoot,
		prefix: '/',
	});

	// SPA fallback: serve index.html for all non-API routes
	app.setNotFoundHandler((request, reply) => {
		if (request.url.startsWith('/api')) {
			reply.status(404).send({ error: 'Not found' });
		} else {
			reply.sendFile('index.html');
		}
	});
}

export default app;
