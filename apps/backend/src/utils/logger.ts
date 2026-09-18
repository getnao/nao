import * as logQueries from '../queries/log.queries';
import type { LogLevel, LogSource } from '../types/log';
import { scheduleTask } from './schedule-task';

interface LogOptions {
	source: LogSource;
	projectId?: string;
	context?: Record<string, unknown>;
}

/** Matches credentials embedded in a URL, e.g. `https://oauth2:TOKEN@host/...` (git clone/push errors). */
const CREDENTIALED_URL_PATTERN = /:\/\/[^/\s@]+@/g;
const AUTHORIZATION_PATTERN =
	/(\bauthorization\b\s*["']?\s*[:=]\s*["']?\s*)(?:(?:bearer|basic|token)\s+)?[^\s"',;}]+/gi;
const BEARER_TOKEN_PATTERN =
	/(\bbearer\s+)(?:[A-Za-z0-9]{20,}|(?=[A-Za-z0-9._~+/-]{10,}=*(?![A-Za-z0-9._~+/-]))(?=[A-Za-z0-9._~+/-]*[0-9._~+/-])[A-Za-z0-9._~+/-]+=*)/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;
const SECRET_QUERY_PATTERN =
	/([?&](?:access[-_]?token|api[-_]?key|client[-_]?secret|refresh[-_]?token|auth[-_]?token|password|secret|token)=)[^&\s]+/gi;
const KNOWN_TOKEN_PATTERN =
	/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{10,})\b/g;

export function sanitizeLogText(value: string): string {
	return value
		.replace(CREDENTIALED_URL_PATTERN, '://***@')
		.replace(AUTHORIZATION_PATTERN, '$1[REDACTED]')
		.replace(BEARER_TOKEN_PATTERN, '$1[REDACTED]')
		.replace(PRIVATE_KEY_PATTERN, '[REDACTED PRIVATE KEY]')
		.replace(SECRET_QUERY_PATTERN, '$1[REDACTED]')
		.replace(KNOWN_TOKEN_PATTERN, '[REDACTED]');
}

/** Extracts structured error info (name, message, stack) from unknown caught values. */
export function serializeError(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: sanitizeLogText(error.message),
			stack: error.stack ? sanitizeLogText(error.stack) : error.stack,
		};
	}
	return { value: sanitizeLogText(String(error)) };
}

const SENSITIVE_KEYS = new Set([
	'password',
	'token',
	'access_token',
	'accesstoken',
	'refresh_token',
	'refreshtoken',
	'auth_token',
	'authtoken',
	'client_secret',
	'clientsecret',
	'secret',
	'authorization',
	'cookie',
	'apikey',
	'api_key',
	'ssh_key',
	'sshkey',
	'private_key',
	'privatekey',
]);

function redactContext(ctx: Record<string, unknown>, visited = new WeakSet<object>()): Record<string, unknown> {
	if (visited.has(ctx)) {
		return { circular: '[Circular]' };
	}
	visited.add(ctx);
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(ctx)) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			redacted[key] = '[REDACTED]';
		} else {
			redacted[key] = redactContextValue(value, visited);
		}
	}
	visited.delete(ctx);
	return redacted;
}

function redactContextValue(value: unknown, visited: WeakSet<object>): unknown {
	if (typeof value === 'string') {
		return sanitizeLogText(value);
	}
	if (Array.isArray(value)) {
		if (visited.has(value)) {
			return '[Circular]';
		}
		visited.add(value);
		const redacted = value.map((entry) => redactContextValue(entry, visited));
		visited.delete(value);
		return redacted;
	}
	if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		if (visited.has(value)) {
			return '[Circular]';
		}
		return redactContext(value as Record<string, unknown>, visited);
	}
	return value;
}

function writeLog(level: LogLevel, message: string, opts: LogOptions): void {
	const prefix = `[${level.toUpperCase()}] [${opts.source}]`;
	const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	const sanitizedMessage = sanitizeLogText(message);
	consoleFn(`${prefix} ${sanitizedMessage}`);

	const context = opts.context ? redactContext(opts.context) : undefined;

	scheduleTask(() =>
		logQueries.insertLog({
			level,
			message: sanitizedMessage,
			source: opts.source,
			projectId: opts.projectId,
			context,
		}),
	);
}

export const logger = {
	error: (message: string, opts: LogOptions) => writeLog('error', message, opts),
	warn: (message: string, opts: LogOptions) => writeLog('warn', message, opts),
	info: (message: string, opts: LogOptions) => writeLog('info', message, opts),
	debug: (message: string, opts: LogOptions) => writeLog('debug', message, opts),
};
