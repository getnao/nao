import { context, type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';

export const REQUEST_TRACER_NAME = 'nao-http';
const UNMATCHED_ROUTE = 'unmatched';
const SERVER_FAILURE_CODE = 'INTERNAL_SERVER_ERROR';

type ProcedureResult = { ok: true } | { ok: false; error: Error & { code: string } };

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
		const route = request.routeOptions.url ?? UNMATCHED_ROUTE;
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
 * Times one tRPC procedure inside its request span. Every procedure is served from the same
 * wildcard route and a batched request runs several of them, so the request span alone
 * cannot tell which procedure is slow or failing.
 */
export async function traceProcedure<Result extends ProcedureResult>(
	requestSpan: Span | undefined,
	path: string,
	runProcedure: () => Promise<Result>,
): Promise<Result> {
	if (!requestSpan) {
		return runProcedure();
	}
	const tracer = trace.getTracer(REQUEST_TRACER_NAME);
	const span = tracer.startSpan(`trpc ${path}`, {}, trace.setSpan(context.active(), requestSpan));
	try {
		const result = await runProcedure();
		if (!result.ok && result.error.code === SERVER_FAILURE_CODE) {
			span.recordException(result.error);
			span.setStatus({ code: SpanStatusCode.ERROR });
		}
		return result;
	} finally {
		span.end();
	}
}
