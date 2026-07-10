import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import { env } from './env';

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

export const langfuseSpanProcessor = keysPresent && baseUrl ? new LangfuseSpanProcessor({ baseUrl }) : undefined;

if (keysPresent && !baseUrl) {
	console.warn(
		'Langfuse keys are set but LANGFUSE_BASE_URL is missing — tracing stays disabled. ' +
			'Set it explicitly (e.g. https://cloud.langfuse.com or your self-hosted instance) to enable export.',
	);
}

if (langfuseSpanProcessor) {
	const tracerProvider = new NodeTracerProvider({
		spanProcessors: [langfuseSpanProcessor],
	});
	tracerProvider.register();

	// The processor batches and flushes on its own interval; this only guards
	// the final buffer on a clean exit. Signal-driven shutdown (SIGTERM/SIGINT,
	// the normal path in Docker) does not fire `beforeExit`, so the server's
	// graceful shutdown hook calls `flushTelemetry` explicitly.
	process.once('beforeExit', () => {
		void flushTelemetry();
	});

	console.log(`✓ Langfuse tracing enabled → ${baseUrl}`);
}

export async function flushTelemetry(): Promise<void> {
	try {
		await langfuseSpanProcessor?.forceFlush();
	} catch {
		// Flushing traces must never block or fail shutdown.
	}
}
