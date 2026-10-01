/**
 * JavaScript evaluated inside the QuickJS VM before the script. It keeps the single host bridge in a
 * closure, so the script can only reach the host through the functions built here: one frozen global
 * namespace per first path segment (`mcp.linear.get_ticket`), `console`, and nothing else.
 *
 * Evaluates to `(bridge, functionsJson) => { settle, run, stalled }`. `functionsJson` lists the path
 * of each callable function; a call reaches the host as `bridge("call", id, index, argsJson)`.
 * Values cross the VM boundary as JSON strings only.
 */
export const PRELUDE_SOURCE = `(function (bridge, functionsJson) {
	"use strict";
	const stringify = JSON.stringify;
	const parse = JSON.parse;
	const promiseThen = Promise.prototype.then;
	const ErrorCtor = Error;
	const TypeErrorCtor = TypeError;
	const pending = new Map();
	let nextCallId = 1;
	let finished = false;

	function finish(ok, payload) {
		if (finished) return;
		finished = true;
		bridge("done", ok, payload, undefined);
	}

	function errorText(error) {
		const head = error.message ? error.name + ": " + error.message : String(error.name);
		const frames =
			typeof error.stack === "string"
				? error.stack.split("\\n").filter((line) => line.trim() && !line.includes("codemode-prelude.js"))
				: [];
		return [head, ...frames].join("\\n");
	}

	function format(value) {
		if (typeof value === "string") return value;
		if (value instanceof ErrorCtor) return errorText(value);
		try {
			const json = stringify(value, null, 2);
			return json === undefined ? String(value) : json;
		} catch {
			return String(value);
		}
	}

	function describeError(error) {
		if (error instanceof ErrorCtor) {
			return stringify({ name: error.name, message: error.message, stack: errorText(error) });
		}
		return stringify({ message: format(error) });
	}

	function createFunction(index) {
		return (args) =>
			new Promise((resolve, reject) => {
				let json;
				try {
					json = args === undefined ? undefined : stringify(args);
				} catch (error) {
					reject(error);
					return;
				}
				const id = nextCallId++;
				pending.set(id, { resolve, reject });
				bridge("call", id, index, json);
			});
	}

	function toIdentifier(name) {
		let identifier = "";
		for (const char of name) {
			const valid = identifier === "" ? /^[A-Za-z_$]$/.test(char) : /^[A-Za-z0-9_$]$/.test(char);
			identifier += valid ? char : "_";
		}
		return identifier === "" ? "_" : identifier;
	}

	const PASSTHROUGH_KEYS = new Set(["then", "toJSON", "constructor", "valueOf", "toString"]);

	function freezeNamespace(node, path) {
		const names = Object.keys(node);
		for (const name of names) {
			if (typeof node[name] !== "function") node[name] = freezeNamespace(node[name], path + "." + name);
			const alias = toIdentifier(name);
			if (!(alias in node)) node[alias] = node[name];
		}
		Object.freeze(node);
		return new Proxy(node, {
			get(target, key) {
				if (typeof key !== "string" || key in target || PASSTHROUGH_KEYS.has(key)) return target[key];
				throw new TypeErrorCtor(path + "." + key + " does not exist. Available: " + (names.join(", ") || "nothing"));
			},
		});
	}

	const roots = Object.create(null);
	parse(functionsJson).forEach((functionPath, index) => {
		let node = roots;
		for (const segment of functionPath.slice(0, -1)) {
			if (typeof node[segment] !== "object") node[segment] = Object.create(null);
			node = node[segment];
		}
		node[functionPath[functionPath.length - 1]] = createFunction(index);
	});
	for (const name of Object.keys(roots)) {
		Object.defineProperty(globalThis, name, { value: freezeNamespace(roots[name], name), enumerable: true });
	}

	const console = {};
	for (const level of ["log", "info", "warn", "error", "debug"]) {
		console[level] = (...args) => {
			if (!finished) bridge("log", args.map(format).join(" "), undefined, undefined);
		};
	}
	Object.defineProperty(globalThis, "console", { value: Object.freeze(console), enumerable: true });

	return {
		settle(id, ok, payload) {
			const entry = pending.get(id);
			if (!entry) return;
			pending.delete(id);
			if (!ok) {
				entry.reject(new ErrorCtor(payload));
				return;
			}
			try {
				entry.resolve(payload === undefined ? undefined : parse(payload));
			} catch (error) {
				entry.reject(error);
			}
		},
		run(fn) {
			let promise;
			try {
				promise = fn();
			} catch (error) {
				finish(false, describeError(error));
				return;
			}
			promiseThen.call(
				promise,
				(value) => {
					let json;
					try {
						json = value === undefined ? undefined : stringify(value);
					} catch (error) {
						finish(false, describeError(error));
						return;
					}
					finish(true, json);
				},
				(error) => finish(false, describeError(error)),
			);
		},
		stalled() {
			if (finished || pending.size > 0) return false;
			finish(
				false,
				stringify({
					name: "Error",
					message: "The script awaits a promise that can never settle: no call is pending and there are no timers.",
				}),
			);
			return true;
		},
	};
})`;
