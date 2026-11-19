import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { TRPCError } from '@trpc/server';
import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerRequestTracing, traceProcedure } from '../../src/middleware/request-tracing';

const HEALTH_PATH = '/api/health';
const exporter = new InMemorySpanExporter();

type ProcedureResult = { ok: true } | { ok: false; error: TRPCError };

beforeEach(() => {
	trace.setGlobalTracerProvider(new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
});

afterEach(() => {
	exporter.reset();
	trace.disable();
});

describe('registerRequestTracing', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = fastify();
		registerRequestTracing(app, [HEALTH_PATH]);
		app.get(HEALTH_PATH, async () => {
			return { status: 'ok' };
		});
		app.get('/api/stories/:storyId', async (request) => {
			request.actorUserId = 'user-1';
			return { ok: true };
		});
		app.get('/api/trpc/:path', async () => {
			return { ok: true };
		});
		app.get('/api/broken', async () => {
			throw new Error('warehouse unreachable');
		});
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	it.each([
		['a matched route by its pattern', '/api/stories/42?tab=chart', 'GET /api/stories/:storyId', 200],
		['a tRPC batch by its route', '/api/trpc/chat.list,project.get?batch=1', 'GET /api/trpc/:path', 200],
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

describe('traceProcedure', () => {
	const results: [string, ProcedureResult, SpanStatusCode][] = [
		['a successful procedure', { ok: true }, SpanStatusCode.UNSET],
		['a client error', { ok: false, error: new TRPCError({ code: 'NOT_FOUND' }) }, SpanStatusCode.UNSET],
		[
			'a server failure',
			{ ok: false, error: new TRPCError({ code: 'INTERNAL_SERVER_ERROR' }) },
			SpanStatusCode.ERROR,
		],
	];

	it.each(results)('records %s under its request span', async (_case, result, expectedStatus) => {
		const requestSpan = trace.getTracer('test').startSpan('GET /api/trpc/:path');

		const returned = await traceProcedure(requestSpan, 'chat.list', async () => {
			return result;
		});

		const [span] = exporter.getFinishedSpans();
		expect(returned).toBe(result);
		expect(span.name).toBe('trpc chat.list');
		expect(span.parentSpanContext?.spanId).toBe(requestSpan.spanContext().spanId);
		expect(span.status.code).toBe(expectedStatus);
	});

	it('runs a procedure untraced outside a traced request', async () => {
		const returned = await traceProcedure<ProcedureResult>(undefined, 'chat.list', async () => {
			return { ok: true };
		});

		expect(returned).toEqual({ ok: true });
		expect(exporter.getFinishedSpans()).toHaveLength(0);
	});
});
