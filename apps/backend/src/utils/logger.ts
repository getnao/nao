import * as logQueries from '../queries/log.queries';
import type { LogLevel, LogSource } from '../types/log';
import { scheduleTask } from './schedule-task';

interface LogOptions {
	source: LogSource;
	projectId?: string;
	context?: Record<string, unknown>;
}

/** Extracts structured error info (name, message, stack) from unknown caught values. */
export function serializeError(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		return { name: error.name, message: error.message, stack: error.stack };
	}
	return { value: String(error) };
}

const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'authorization', 'cookie', 'apikey', 'api_key']);

function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(ctx)) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			redacted[key] = '[REDACTED]';
		} else {
			redacted[key] = value;
		}
	}
	return redacted;
}

function writeLog(level: LogLevel, message: string, opts: LogOptions): void {
	const prefix = `[${level.toUpperCase()}] [${opts.source}]`;
	const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	consoleFn(`${prefix} ${message}`);

	const context = opts.context ? redactContext(opts.context) : undefined;

	scheduleTask(() =>
		logQueries.insertLog({
			level,
			message,
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
