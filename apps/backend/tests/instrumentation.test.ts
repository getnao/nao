import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { expect, it } from 'vitest';

import { onlyRequestSpans } from '../src/instrumentation';
import { REQUEST_TRACER_NAME } from '../src/middleware/request-tracing';

it('exports request spans only, never LLM or library spans', async () => {
	const exporter = new InMemorySpanExporter();
	const provider = new NodeTracerProvider({
		spanProcessors: [onlyRequestSpans(new SimpleSpanProcessor(exporter))],
	});

	provider.getTracer('ai').startSpan('ai.streamText').end();
	provider.getTracer('better-auth').startSpan('handler /get-session').end();
	provider.getTracer(REQUEST_TRACER_NAME).startSpan('GET /api/agent').end();
	await provider.forceFlush();

	const exportedNames = exporter.getFinishedSpans().map((span) => {
		return span.name;
	});
	expect(exportedNames).toEqual(['GET /api/agent']);
});
