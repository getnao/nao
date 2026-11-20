import { context, propagation, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { Effect } from 'effect';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../helpers/logger-mock';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

import { fromPromise, repeatInBackground, runEffect, withHeartbeat } from '../../src/utils/effect-runtime';
import { EFFECT_TRACER_NAME } from '../../src/utils/tracer-names';

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('repeatInBackground', () => {
	it('logs a failed run and still runs the next ones', async () => {
		const task = vi.fn().mockRejectedValueOnce(new Error('database is down')).mockResolvedValue(undefined);

		const stop = repeatInBackground('Stream sweep', fromPromise(task), 1_000, { immediately: true });
		await vi.advanceTimersByTimeAsync(2_000);
		await stop();
		await vi.advanceTimersByTimeAsync(5_000);

		expect(task).toHaveBeenCalledTimes(3);
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith('Stream sweep failed: database is down', expect.anything());
	});
});

describe('withHeartbeat', () => {
	it('beats while the operation runs and stops once it settles', async () => {
		const beat = vi.fn().mockResolvedValue(undefined);
		let finish: () => void = () => undefined;
		const operation = new Promise<string>((resolve) => {
			finish = () => resolve('transferred');
		});

		const result = runEffect(
			fromPromise(() => operation).pipe(withHeartbeat({ name: 'Lease', beat, every: 1_000 })),
		);
		await vi.advanceTimersByTimeAsync(2_500);
		finish();

		await expect(result).resolves.toBe('transferred');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(beat).toHaveBeenCalledTimes(2);
	});

	it('rejects with the operation’s own error', async () => {
		class StoryLockedError extends Error {}
		const beat = vi.fn().mockResolvedValue(undefined);

		const result = runEffect(
			fromPromise(() => Promise.reject(new StoryLockedError('locked'))).pipe(
				withHeartbeat({ name: 'Lease', beat, every: 1_000 }),
			),
		);

		await expect(result).rejects.toBeInstanceOf(StoryLockedError);
	});
});

describe('tracing', () => {
	const exporter = new InMemorySpanExporter();

	beforeAll(() => {
		new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();
	});

	afterAll(() => {
		trace.disable();
		context.disable();
		propagation.disable();
	});

	it('exports Effect spans under their own tracer without parenting the spans started inside them', async () => {
		await runEffect(
			Effect.sync(() => trace.getTracer('ai').startSpan('ai.generateText').end()).pipe(
				Effect.withSpan('scheduler.job'),
			),
		);

		const spans = exporter.getFinishedSpans();
		const jobSpan = spans.find((span) => span.name === 'scheduler.job');
		const llmSpan = spans.find((span) => span.name === 'ai.generateText');
		expect(jobSpan?.instrumentationScope.name).toBe(EFFECT_TRACER_NAME);
		expect(llmSpan?.parentSpanContext).toBeUndefined();
	});
});
