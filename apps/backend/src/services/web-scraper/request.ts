import type { HeaderValues } from './types';

export const SENSITIVE_HEADERS = new Set([
	'authorization',
	'cookie',
	'proxy-authorization',
	'x-api-key',
	'x-auth-token',
	'x-csrf-token',
]);

export const resolveHeaders = (
	headers: Record<string, string | { env: string }> | undefined,
	env: Record<string, string>,
): HeaderValues => {
	const resolved: HeaderValues = {};

	for (const [name, value] of Object.entries(headers ?? {})) {
		if (typeof value === 'string') {
			assertSafeHeaderValue(name, value);
			resolved[name] = value;
			continue;
		}

		const resolvedValue = env[value.env] ?? process.env[value.env];
		if (!resolvedValue) {
			throw new Error(`Header '${name}' references missing environment variable '${value.env}'`);
		}
		resolved[name] = resolvedValue;
	}

	return resolved;
};

export const headersForOrigin = (headers: HeaderValues, origin: string, initialOrigin: string): HeaderValues => {
	if (origin === initialOrigin) {
		return headers;
	}
	return Object.fromEntries(Object.entries(headers).filter(([name]) => !SENSITIVE_HEADERS.has(name.toLowerCase())));
};

const assertSafeHeaderValue = (name: string, _value: string): void => {
	if (!SENSITIVE_HEADERS.has(name.toLowerCase())) {
		return;
	}
	throw new Error(`Header '${name}' must reference an environment variable instead of storing a secret value`);
};

export const delay = (ms: number, signal?: AbortSignal): Promise<void> => {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new Error('Web robot run was cancelled'));
			},
			{ once: true },
		);
	});
};

export const readResponseWithLimit = async (response: Response, maxBytes: number): Promise<string> => {
	const contentLength = Number(response.headers.get('content-length') ?? 0);
	if (contentLength > maxBytes) {
		throw new Error(`Response exceeds the ${maxBytes} byte limit`);
	}
	if (!response.body) {
		return response.text();
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error(`Response exceeds the ${maxBytes} byte limit`);
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
};
