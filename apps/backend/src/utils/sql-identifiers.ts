import { TRPCError } from '@trpc/server';

export function assertSafeSqlIdentifier(value: string, kind: 'table' | 'column'): string {
	const unquoted = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
	const doubleQuoted = /^"[^"]+"(\."[^"]+")*$/;
	const backtickQuoted = /^`[^`]+`(\.`[^`]+`)*$/;
	if (!unquoted.test(value) && !doubleQuoted.test(value) && !backtickQuoted.test(value)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid filter ${kind} identifier "${value}". Use unquoted names, "double quotes", or \`backticks\` (required for hyphens).`,
		});
	}
	return value;
}
