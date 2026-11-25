import { TRPCError } from '@trpc/server';

import { logger } from './logger';
import { PathEscapeError, UnsafeUrlError } from './security-errors';

/**
 * What a probing client trips over. Each one is logged with the `security` source, for the backoffice to score accounts
 * on; nao itself takes no action on them.
 */
export const SECURITY_SIGNALS = ['unknown-procedure', 'ssrf-blocked', 'path-escape', 'rate-limited'] as const;
export type SecuritySignal = (typeof SECURITY_SIGNALS)[number];

interface SignalOptions {
	userId?: string;
	projectId?: string;
}

const MAX_DETAIL_LENGTH = 300;
const MAX_CAUSE_DEPTH = 5;

export function reportSecuritySignal(signal: SecuritySignal, detail: string, options: SignalOptions = {}): void {
	const trimmedDetail = detail.slice(0, MAX_DETAIL_LENGTH);
	logger.warn(`Security signal ${signal}: ${trimmedDetail}`, {
		source: 'security',
		userId: options.userId,
		projectId: options.projectId,
		context: { signal, detail: trimmedDetail },
	});
}

/** Reports the signal an error carries, if any: a call to a procedure that does not exist, or a refused URL or path. */
export function reportSecuritySignalOfError(error: unknown, options: SignalOptions & { path?: string } = {}): void {
	const signal = findSecuritySignal(error, options.path);
	if (signal) {
		reportSecuritySignal(signal.signal, signal.detail, options);
	}
}

export function findSecuritySignal(
	error: unknown,
	procedurePath?: string,
): { signal: SecuritySignal; detail: string } | null {
	if (error instanceof TRPCError && isUnknownProcedureCall(error)) {
		return { signal: 'unknown-procedure', detail: procedurePath ?? error.message };
	}
	let current: unknown = error;
	for (let depth = 0; current instanceof Error && depth < MAX_CAUSE_DEPTH; depth++) {
		if (current instanceof UnsafeUrlError) {
			return { signal: 'ssrf-blocked', detail: current.host };
		}
		if (current instanceof PathEscapeError) {
			return { signal: 'path-escape', detail: current.requestedPath };
		}
		current = current.cause;
	}
	return null;
}

/** tRPC's own refusals of a path that has no procedure, or of a GET to a mutation: the frontend never sends either. */
function isUnknownProcedureCall(error: TRPCError): boolean {
	return (
		(error.code === 'NOT_FOUND' && error.message.startsWith('No procedure found')) ||
		error.code === 'METHOD_NOT_SUPPORTED'
	);
}
