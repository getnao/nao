import { LangfuseSpanProcessor } from '@langfuse/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-node';

import { env } from './env';
import { DataToolRedactingSpanProcessor } from './utils/langfuse-redaction';
import { EFFECT_TRACER_NAME, REQUEST_TRACER_NAME } from './utils/tracer-names';

/**
 * Langfuse tracing is opt-in and requires an explicit destination: it only
 * activates when LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL
 * are all set. Without the explicit base URL the SDK would default to
 * cloud.langfuse.com, silently exporting prompts and responses to a third
 * party — a misconfigured self-hosted deployment must fail closed instead.
 * This module must be imported before any AI SDK call is made.
 */
const keysPresent = Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
const baseUrl = env.LANGFUSE_BASE_URL;

const langfuseSpanProcessor = keysPresent && baseUrl ? new LangfuseSpanProcessor({ baseUrl }) : undefined;

if (keysPresent && !baseUrl) {
	console.warn(
		'Langfuse keys are set but LANGFUSE_BASE_URL is missing — tracing stays disabled. ' +
			'Set it explicitly (e.g. https://cloud.langfuse.com or your self-hosted instance) to enable export.',
	);
}

/**
 * Request traces go to any OpenTelemetry backend once OTEL_EXPORTER_OTLP_ENDPOINT is set; the
 * exporter reads its credentials from OTEL_EXPORTER_OTLP_HEADERS. Only request spans and the spans of
 * Effect programs are exported: LLM spans carry prompts and responses, so they only ever reach Langfuse.
 */
const EXPORTED_TRACER_NAMES = new Set([REQUEST_TRACER_NAME, EFFECT_TRACER_NAME]);

export const requestTracingEnabled = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT);

const spanProcessors: SpanProcessor[] = [
	...(langfuseSpanProcessor ? [new DataToolRedactingSpanProcessor(langfuseSpanProcessor)] : []),
	...(requestTracingEnabled ? [onlyAppSpans(new BatchSpanProcessor(new OTLPTraceExporter()))] : []),
];

if (spanProcessors.length > 0) {
	const tracerProvider = new NodeTracerProvider({
		resource: resourceFromAttributes({
			'service.name': env.OTEL_SERVICE_NAME,
			'service.version': env.APP_VERSION,
		}),
		spanProcessors,
	});
	tracerProvider.register();

	// The processors batch and flush on their own interval; this only guards
	// the final buffer on a clean exit. Signal-driven shutdown (SIGTERM/SIGINT,
	// the normal path in Docker) does not fire `beforeExit`, so the server's
	// graceful shutdown hook calls `flushTelemetry` explicitly.
	process.once('beforeExit', () => {
		void flushTelemetry();
	});

	if (langfuseSpanProcessor) {
		console.log(`✓ Langfuse tracing enabled → ${baseUrl}`);
	}
	if (requestTracingEnabled) {
		console.log(`✓ Request tracing enabled → ${env.OTEL_EXPORTER_OTLP_ENDPOINT}`);
	}
}

export async function flushTelemetry(): Promise<void> {
	try {
		await Promise.all(
			spanProcessors.map((processor) => {
				return processor.forceFlush();
			}),
		);
	} catch {
		// Flushing traces must never block or fail shutdown.
	}
}

export function onlyAppSpans(processor: SpanProcessor): SpanProcessor {
	return {
		onStart(span, parentContext) {
			processor.onStart(span, parentContext);
		},
		onEnd(span) {
			if (EXPORTED_TRACER_NAMES.has(span.instrumentationScope.name)) {
				processor.onEnd(span);
			}
		},
		forceFlush() {
			return processor.forceFlush();
		},
		shutdown() {
			return processor.shutdown();
		},
	};
}
