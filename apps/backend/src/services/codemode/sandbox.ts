import { Worker } from 'node:worker_threads';

import { PRELUDE_SOURCE } from './prelude';
import { loadQuickJsWasm } from './wasm';

export interface CodemodeFunctionContext {
	/** Aborted when the script settles without awaiting the call, times out, or is aborted. */
	signal: AbortSignal;
}

export interface CodemodeFunction {
	/** Where the script finds the function, e.g. `['mcp', 'linear', 'get_ticket']` for `mcp.linear.get_ticket`. */
	path: string[];
	/** Receives the script's argument after a JSON round trip; the returned value must be JSON-serializable. */
	execute: (args: unknown, context: CodemodeFunctionContext) => unknown;
}

export type CodemodeCallStatus = 'ok' | 'error' | 'cancelled';

export interface CodemodeCall {
	name: string;
	status: CodemodeCallStatus;
	durationMs: number;
	error?: string;
}

export type CodemodeErrorKind = 'script' | 'timeout' | 'aborted' | 'sandbox';

export interface CodemodeError {
	kind: CodemodeErrorKind;
	message: string;
	stack?: string;
}

interface CodemodeOutcome {
	logs: string[];
	calls: CodemodeCall[];
}

export type CodemodeResult =
	| (CodemodeOutcome & { ok: true; value: unknown })
	| (CodemodeOutcome & { ok: false; error: CodemodeError });

export interface CodemodeRunOptions {
	/** Body of an async function: top-level `await` and `return` work. */
	code: string;
	functions: CodemodeFunction[];
	timeoutMs: number;
	memoryLimitBytes: number;
	signal?: AbortSignal;
}

/**
 * Runs model-written JavaScript in a fresh QuickJS VM (its own wasm instance) inside a worker
 * thread. The only capability the script has is calling `functions`. Never rejects: script
 * failures, timeouts and aborts come back as `{ ok: false }`.
 */
export function runCodemode(options: CodemodeRunOptions): Promise<CodemodeResult> {
	return new CodemodeExecution(options).result;
}

type WorkerMessage =
	| { type: 'call'; id: number; index: number; args: string | undefined }
	| { type: 'log'; text: string }
	| { type: 'done'; ok: boolean; payload: string | undefined }
	| { type: 'crash'; message: string };

interface PendingCall {
	call: CodemodeCall;
	startedAt: number;
	controller: AbortController;
}

class CodemodeExecution {
	readonly result: Promise<CodemodeResult>;
	private _resolve!: (result: CodemodeResult) => void;
	private _worker: Worker | undefined;
	private readonly _interrupt = new SharedArrayBuffer(4);
	private readonly _logs: string[] = [];
	private readonly _calls: CodemodeCall[] = [];
	private readonly _pending = new Map<number, PendingCall>();
	private readonly _timer: ReturnType<typeof setTimeout>;
	private _finished = false;

	constructor(private readonly _options: CodemodeRunOptions) {
		this.result = new Promise((resolve) => {
			this._resolve = resolve;
		});
		this._timer = setTimeout(() => {
			this._finish({ kind: 'timeout', message: `The script did not finish within ${_options.timeoutMs} ms.` });
		}, _options.timeoutMs);

		if (_options.signal?.aborted) {
			this._onAbort();
		} else {
			_options.signal?.addEventListener('abort', this._onAbort, { once: true });
		}

		loadQuickJsWasm().then(
			(wasm) => this._start(wasm),
			(error: unknown) =>
				this._finish({ kind: 'sandbox', message: `Failed to load QuickJS: ${messageOf(error)}` }),
		);
	}

	private _start(wasm: WebAssembly.Module): void {
		if (this._finished) {
			return;
		}
		try {
			this._worker = new Worker(workerSpecifier(), {
				workerData: {
					code: this._options.code,
					prelude: PRELUDE_SOURCE,
					functionPaths: this._options.functions.map((fn) => fn.path),
					wasm,
					memoryLimitBytes: this._options.memoryLimitBytes,
					interrupt: this._interrupt,
				},
			});
		} catch (error) {
			this._finish({ kind: 'sandbox', message: `Failed to start the sandbox worker: ${messageOf(error)}` });
			return;
		}
		this._worker.on('message', (message: WorkerMessage) => this._handleMessage(message));
		this._worker.on('error', (error) => this._finish({ kind: 'sandbox', message: messageOf(error) }));
		this._worker.on('exit', (code) => {
			this._finish({
				kind: 'sandbox',
				message: `The sandbox worker exited with code ${code} before the script settled.`,
			});
		});
	}

	private readonly _onAbort = (): void => {
		this._finish({ kind: 'aborted', message: 'The script was aborted.' });
	};

	private _handleMessage(message: WorkerMessage): void {
		if (this._finished) {
			return;
		}
		switch (message.type) {
			case 'call':
				void this._handleCall(message);
				return;
			case 'log':
				this._logs.push(message.text);
				return;
			case 'done':
				this._handleDone(message);
				return;
			case 'crash':
				this._finish({ kind: 'sandbox', message: message.message });
		}
	}

	private _handleDone({ ok, payload }: Extract<WorkerMessage, { type: 'done' }>): void {
		if (ok) {
			this._finish(undefined, payload === undefined ? undefined : JSON.parse(payload));
			return;
		}
		const error = JSON.parse(payload ?? '{}') as { name?: string; message?: string; stack?: string };
		this._finish({ kind: 'script', message: error.message ?? 'The script failed.', stack: error.stack });
	}

	private async _handleCall({ id, index, args }: Extract<WorkerMessage, { type: 'call' }>): Promise<void> {
		const fn = this._options.functions[index];
		const call: CodemodeCall = { name: fn?.path.join('.') ?? 'unknown', status: 'cancelled', durationMs: 0 };
		const pending: PendingCall = { call, startedAt: performance.now(), controller: new AbortController() };
		this._calls.push(call);
		this._pending.set(id, pending);

		let reply: { id: number; ok: boolean; payload: string | undefined };
		try {
			if (!fn) {
				throw new Error(`Unknown function #${index}.`);
			}
			const value = await fn.execute(args === undefined ? undefined : JSON.parse(args), {
				signal: pending.controller.signal,
			});
			reply = { id, ok: true, payload: value === undefined ? undefined : JSON.stringify(value) };
			call.status = 'ok';
		} catch (error) {
			reply = { id, ok: false, payload: messageOf(error) };
			call.status = 'error';
			call.error = messageOf(error);
		}

		if (!this._pending.delete(id)) {
			call.status = 'cancelled';
			return;
		}
		call.durationMs = performance.now() - pending.startedAt;
		this._worker?.postMessage(reply);
	}

	private _finish(error: CodemodeError | undefined, value?: unknown): void {
		if (this._finished) {
			return;
		}
		this._finished = true;
		clearTimeout(this._timer);
		this._options.signal?.removeEventListener('abort', this._onAbort);
		this._cancelPendingCalls();

		const outcome = { logs: this._logs, calls: this._calls };
		const result: CodemodeResult = error ? { ...outcome, ok: false, error } : { ...outcome, ok: true, value };
		if (!this._worker) {
			this._resolve(result);
			return;
		}
		Atomics.store(new Int32Array(this._interrupt), 0, 1);
		this._worker
			.terminate()
			.catch(() => undefined)
			.then(() => this._resolve(result));
	}

	private _cancelPendingCalls(): void {
		const now = performance.now();
		for (const pending of this._pending.values()) {
			pending.call.status = 'cancelled';
			pending.call.durationMs = now - pending.startedAt;
			pending.controller.abort();
		}
		this._pending.clear();
	}
}

/**
 * A Bun compiled binary embeds the worker as an extra entrypoint of `build:standalone`, addressed by
 * its path from the backend root rather than relative to this (bundled) module.
 */
function workerSpecifier(): string | URL {
	const isCompiledBinary = typeof Bun !== 'undefined' && /(\$bunfs|~BUN)/.test(Bun.main);
	return isCompiledBinary ? './src/services/codemode/worker.mjs' : new URL('./worker.mjs', import.meta.url);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
