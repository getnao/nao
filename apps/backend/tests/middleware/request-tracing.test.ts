import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerRequestTracing } from '../../src/middleware/request-tracing';

const HEALTH_PATH = '/api/health';

describe('registerRequestTracing', () => {
	const exporter = new InMemorySpanExporter();
	let app: FastifyInstance;

	beforeEach(async () => {
		trace.setGlobalTracerProvider(new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
		app = fastify();
		registerRequestTracing(app, [HEALTH_PATH]);
		app.get(HEALTH_PATH, async () => {
			return { status: 'ok' };
		});
		app.get('/api/stories/:storyId', async (request) => {
			request.actorUserId = 'user-1';
			return { ok: true };
		});
		app.get('/api/trpc/*', async (request, reply) => {
			return reply.status(request.url.includes('unknown') ? 404 : 200).send({});
		});
		app.get('/api/broken', async () => {
			throw new Error('warehouse unreachable');
		});
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
		exporter.reset();
		trace.disable();
	});

	it.each([
		['a matched route by its pattern', '/api/stories/42?tab=chart', 'GET /api/stories/:storyId', 200],
		['a tRPC call by its procedure', '/api/trpc/chat.list?batch=1&input=%7B%7D', 'GET /api/trpc/chat.list', 200],
		['an unknown tRPC procedure by the wildcard', '/api/trpc/unknown.probe', 'GET /api/trpc/*', 404],
		['an unknown URL without its path', '/wp-login.php', 'GET unmatched', 404],
	])('names %s', async (_case, url, expectedName, expectedStatus) => {
		await app.inject({ method: 'GET', url });

		const [span] = exporter.getFinishedSpans();
		expect(span.name).toBe(expectedName);
		expect(span.kind).toBe(SpanKind.SERVER);
		expect(span.attributes['http.response.status_code']).toBe(expectedStatus);
		expect(span.status.code).toBe(SpanStatusCode.UNSET);
	});

	it('records who made the request', async () => {
		await app.inject({ method: 'GET', url: '/api/stories/42' });

		expect(exporter.getFinishedSpans()[0].attributes['user.id']).toBe('user-1');
	});

	it('marks a server error and keeps its exception', async () => {
		await app.inject({ method: 'GET', url: '/api/broken' });

		const [span] = exporter.getFinishedSpans();
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.events[0].attributes?.['exception.message']).toBe('warehouse unreachable');
	});

	it('does not trace an ignored path', async () => {
		await app.inject({ method: 'GET', url: HEALTH_PATH });

		expect(exporter.getFinishedSpans()).toHaveLength(0);
	});
});
