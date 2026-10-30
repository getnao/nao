/**
 * Worker thread running one codemode script in a fresh QuickJS VM, so a spinning script never blocks
 * the server's event loop. Plain JavaScript so Bun, Bun compiled binaries and Node can all start it.
 * The host terminates the worker once the script settles, times out, or is aborted.
 */
import { setImmediate } from 'node:timers';
import { parentPort, workerData } from 'node:worker_threads';

import { JSException, MAX_STACK_SIZE, QuickJS } from 'quickjs-wasi';

const LOG_LIMIT_NOTICE = '... [log limit reached, later logs dropped]';

let remainingLogChars = workerData.maxLogChars;
let remainingCalls = workerData.maxCalls;
let remainingCallArgsChars = workerData.maxCallArgsChars;

main(workerData).catch(reportCrash);

async function main({ code, prelude, functionPaths, wasm, memoryLimitBytes, interrupt }) {
	const interruptFlag = new Int32Array(interrupt);
	const vm = await QuickJS.create({
		wasm,
		memoryLimit: memoryLimitBytes,
		maxStackSize: MAX_STACK_SIZE,
		interruptHandler: () => Atomics.load(interruptFlag, 0) !== 0,
		wasi: discardOutput,
	});

	const bridge = vm.newFunction('bridge', (kind, first, second, third) => {
		forwardToHost(kind.toString(), first, second, third, settleCall);
		return vm.undefined;
	});
	const api = vm.callFunction(
		vm.evalCode(prelude, 'codemode-prelude.js'),
		vm.undefined,
		bridge,
		vm.newString(JSON.stringify(functionPaths)),
	);
	const settle = api.getProp('settle');
	const run = api.getProp('run');
	const stalled = api.getProp('stalled');

	const drainJobs = () => {
		vm.executePendingJobs();
		vm.callFunction(stalled, api).dispose();
	};

	const settleCall = ({ id, ok, payload }) => {
		try {
			vm.withScope(() => {
				vm.callFunction(
					settle,
					api,
					vm.newNumber(id),
					ok ? vm.true : vm.false,
					payload === undefined ? vm.undefined : vm.newString(payload),
				);
			});
			drainJobs();
		} catch (error) {
			reportCrash(error);
		}
	};
	parentPort.on('message', settleCall);

	let script;
	try {
		script = vm.evalCode(`(async () => {${code}\n})`, 'codemode.js');
	} catch (error) {
		if (!(error instanceof JSException)) {
			throw error;
		}
		parentPort.postMessage({ type: 'done', ok: false, payload: describeException(error) });
		return;
	}
	vm.callFunction(run, api, script).dispose();
	script.dispose();
	drainJobs();
}

function forwardToHost(kind, first, second, third, settleCall) {
	switch (kind) {
		case 'call':
			forwardCall(first.toNumber(), second.toNumber(), optionalString(third), settleCall);
			return;
		case 'log':
			forwardLog(first);
			return;
		case 'done':
			parentPort.postMessage({ type: 'done', ok: first.toBoolean(), payload: optionalString(second) });
	}
}

/**
 * The log budget lives here rather than in the VM, where the script can patch the built-ins the prelude
 * relies on. Only string handles are read: converting anything else would run guest code.
 */
function forwardLog(handle) {
	if (remainingLogChars < 0 || !handle.isString) {
		return;
	}
	const text = handle.toString();
	const cost = text.length + 1;
	if (cost > remainingLogChars) {
		parentPort.postMessage({ type: 'log', text: text.slice(0, remainingLogChars) + LOG_LIMIT_NOTICE });
		remainingLogChars = -1;
		return;
	}
	remainingLogChars -= cost;
	parentPort.postMessage({ type: 'log', text });
}

/**
 * Call budgets live here for the same reason as the log budget. A rejected call is settled on a later
 * turn, since the bridge runs while the VM is still executing the script.
 */
function forwardCall(id, index, args, settleCall) {
	const rejection = consumeCallBudget(args);
	if (rejection) {
		setImmediate(() => settleCall({ id, ok: false, payload: rejection }));
		return;
	}
	parentPort.postMessage({ type: 'call', id, index, args });
}

function consumeCallBudget(args) {
	if (remainingCalls === 0) {
		return `The script reached the limit of ${workerData.maxCalls} calls: process fewer items per script.`;
	}
	const argsChars = args?.length ?? 0;
	if (argsChars > remainingCallArgsChars) {
		return `The script reached the limit of ${workerData.maxCallArgsChars} characters of call arguments.`;
	}
	remainingCalls--;
	remainingCallArgsChars -= argsChars;
	return undefined;
}

function optionalString(handle) {
	return handle?.isString ? handle.toString() : undefined;
}

/** QuickJS engine diagnostics go to fd 1 and 2; they belong to nobody, so they are dropped. */
function discardOutput(memory) {
	return {
		fd_write(_fd, iovsPtr, iovsLen, writtenPtr) {
			const view = new DataView(memory.buffer);
			let written = 0;
			for (let i = 0; i < iovsLen; i++) {
				written += view.getUint32(iovsPtr + i * 8 + 4, true);
			}
			view.setUint32(writtenPtr, written, true);
			return 0;
		},
	};
}

function describeException(error) {
	const head = error.message ? `${error.name}: ${error.message}` : error.name;
	const stack = error.stack?.trimEnd();
	return JSON.stringify({ name: error.name, message: error.message, stack: stack ? `${head}\n${stack}` : head });
}

function reportCrash(error) {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	parentPort?.postMessage({ type: 'crash', message });
}
