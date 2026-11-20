import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { trace } from '@opentelemetry/api';
import { Clock, Context, Duration, Effect, Fiber, FiberSet, Layer, ManagedRuntime, Tracer } from 'effect';

import { describeError, logger, serializeError } from './logger';
import { EFFECT_TRACER_NAME } from './tracer-names';

export interface Heartbeat {
	name: string;
	beat: () => Promise<unknown>;
	every: Duration.Input;
}

class BackgroundFibers extends Context.Service<BackgroundFibers, FiberSet.FiberSet>()('nao/BackgroundFibers') {}

const runtime = ManagedRuntime.make(
	Layer.mergeAll(
		tracingLayer(),
		Layer.succeed(Clock.Clock, clockThatLetsTheProcessExit()),
		Layer.effect(BackgroundFibers, FiberSet.make()),
	),
);

/** Runs an Effect program from Promise-based code. The promise rejects with the program's own error. */
export function runEffect<A, E>(program: Effect.Effect<A, E>): Promise<A> {
	return runtime.runPromise(program);
}

/** Lifts Promise-based code into Effect and keeps its rejection as the typed error. */
export function fromPromise<A>(run: (signal: AbortSignal) => PromiseLike<A>): Effect.Effect<A, unknown> {
	return Effect.tryPromise({ try: run, catch: (error) => error });
}

/** Starts `task` without waiting for it. */
export function runInBackground(task: Effect.Effect<unknown>): void {
	forkInBackground(task);
}

/**
 * Runs `task` every `every` until the returned function is called. A failed run is logged and the next one still
 * happens. Stopping waits for the run in progress when that run is uninterruptible.
 */
export function repeatInBackground(
	name: string,
	task: Effect.Effect<unknown, unknown>,
	every: Duration.Input,
	options: { immediately?: boolean } = {},
): () => Promise<void> {
	const loop = repeatForever(name, task, every);
	const fiber = forkInBackground(options.immediately ? Effect.andThen(logFailure(name, task), loop) : loop);
	return () => runtime.runPromise(Fiber.interrupt(fiber));
}

/** Runs the operation while `heartbeat.beat` runs every `heartbeat.every`, and stops the beats once it settles. */
export function withHeartbeat(heartbeat: Heartbeat) {
	return <A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* Effect.forkScoped(repeatForever(heartbeat.name, fromPromise(heartbeat.beat), heartbeat.every));
				return yield* operation;
			}),
		);
}

function forkInBackground<A, E>(task: Effect.Effect<A, E>): Fiber.Fiber<A, E> {
	return runtime.runSync(
		Effect.gen(function* () {
			const fibers = yield* BackgroundFibers;
			return yield* FiberSet.run(fibers, task);
		}),
	);
}

function repeatForever(
	name: string,
	task: Effect.Effect<unknown, unknown>,
	every: Duration.Input,
): Effect.Effect<never> {
	return logFailure(name, task).pipe(Effect.delay(every), Effect.forever);
}

function logFailure(name: string, task: Effect.Effect<unknown, unknown>): Effect.Effect<void> {
	return task.pipe(
		Effect.asVoid,
		Effect.catch((error) =>
			Effect.sync(() => {
				logger.error(`${name} failed: ${describeError(error)}`, {
					source: 'system',
					context: serializeError(error),
				});
			}),
		),
	);
}

/**
 * Effect spans go to the global OpenTelemetry provider under their own tracer name. They do not become the active
 * OpenTelemetry context, so the AI SDK spans that Langfuse receives keep their own traces.
 */
function tracingLayer() {
	return Layer.effect(
		Tracer.Tracer,
		Effect.map(OtelTracer.make, (otelTracer) => Tracer.make({ span: (options) => otelTracer.span(options) })),
	).pipe(Layer.provide(Layer.sync(OtelTracer.OtelTracer, () => trace.getTracer(EFFECT_TRACER_NAME))));
}

/** Background loops wait on timers that never keep the process alive, like the unref'd intervals they replaced. */
function clockThatLetsTheProcessExit(): Clock.Clock {
	const clock = Effect.runSync(Effect.clockWith(Effect.succeed));
	return {
		currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
		currentTimeMillis: clock.currentTimeMillis,
		currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
		currentTimeNanos: clock.currentTimeNanos,
		monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
		monotonicTimeNanos: clock.monotonicTimeNanos,
		sleep: (duration) =>
			Effect.callback<void>((resume) => {
				const timer = setTimeout(() => resume(Effect.void), Duration.toMillis(duration));
				timer.unref?.();
				return Effect.sync(() => clearTimeout(timer));
			}),
	};
}
