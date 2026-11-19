import { type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const REQUEST_TRACER_NAME = 'nao-http';
const TRPC_PREFIX = '/api/trpc/';
const UNMATCHED_ROUTE = 'unmatched';

declare module 'fastify' {
	interface FastifyRequest {
		requestSpan?: Span;
	}
}

/**
 * Records one server span per request, named after the matched route rather than the URL,
 * so that latency and error rate group per endpoint in the tracing backend.
 */
export function registerRequestTracing(app: FastifyInstance, ignoredPaths: string[] = []): void {
	const tracer = trace.getTracer(REQUEST_TRACER_NAME);

	app.addHook('onRequest', async (request) => {
		if (!ignoredPaths.includes(request.url)) {
			request.requestSpan = tracer.startSpan(request.method, { kind: SpanKind.SERVER });
		}
	});

	app.addHook('onError', async (request, _reply, error) => {
		request.requestSpan?.recordException(error);
	});

	app.addHook('onResponse', async (request, reply) => {
		const span = request.requestSpan;
		if (!span) {
			return;
		}
		const route = describeRoute(request, reply);
		span.updateName(`${request.method} ${route}`);
		span.setAttributes({
			'http.request.method': request.method,
			'http.route': route,
			'http.response.status_code': reply.statusCode,
			'user.id': request.actorUserId,
		});
		if (reply.statusCode >= 500) {
			span.setStatus({ code: SpanStatusCode.ERROR });
		}
		span.end();
	});
}

/**
 * tRPC serves every procedure from one wildcard route, so its endpoint is the procedure path.
 * A 404 keeps the wildcard: unknown procedures would otherwise create one endpoint per probed URL.
 */
function describeRoute(request: FastifyRequest, reply: FastifyReply): string {
	const path = request.url.split('?')[0];
	if (path.startsWith(TRPC_PREFIX) && reply.statusCode !== 404) {
		return path;
	}
	return request.routeOptions.url ?? UNMATCHED_ROUTE;
}
