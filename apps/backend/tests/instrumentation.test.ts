import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { expect, it } from 'vitest';

import { onlyAppSpans } from '../src/instrumentation';
import { EFFECT_TRACER_NAME, REQUEST_TRACER_NAME } from '../src/utils/tracer-names';

it('exports request and Effect spans only, never LLM or library spans', async () => {
	const exporter = new InMemorySpanExporter();
	const provider = new NodeTracerProvider({
		spanProcessors: [onlyAppSpans(new SimpleSpanProcessor(exporter))],
	});

	provider.getTracer('ai').startSpan('ai.streamText').end();
	provider.getTracer('better-auth').startSpan('handler /get-session').end();
	provider.getTracer(REQUEST_TRACER_NAME).startSpan('GET /api/agent').end();
	provider.getTracer(EFFECT_TRACER_NAME).startSpan('scheduler.job').end();
	await provider.forceFlush();

	const exportedNames = exporter.getFinishedSpans().map((span) => {
		return span.name;
	});
	expect(exportedNames).toEqual(['GET /api/agent', 'scheduler.job']);
});
