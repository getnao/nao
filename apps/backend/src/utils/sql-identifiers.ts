import { TRPCError } from '@trpc/server';

const HYPHENATED_PART = '[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+';
const PLAIN_PART = '[A-Za-z_][A-Za-z0-9_]*';
const DOUBLE_QUOTED_PART = '"[^"]+"';
const BACKTICK_QUOTED_PART = '`[^`]+`';
const HYPHENATED_PART_REGEX = new RegExp(`^${HYPHENATED_PART}$`);

/**
 * Validates a dotted identifier whose parts may each be plain, "double quoted" or `backtick quoted`.
 * Tables also accept unquoted hyphenated parts (BigQuery project ids), which are wrapped in backticks.
 */
export function toSafeSqlIdentifier(value: string, kind: 'table' | 'column'): string {
	const parts = splitIdentifierParts(value, kind);
	if (!parts) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid filter ${kind} identifier "${value}". Use unquoted names, "double quotes", or \`backticks\` (required for hyphens).`,
		});
	}
	return parts.map(quoteHyphenatedPart).join('.');
}

function splitIdentifierParts(value: string, kind: 'table' | 'column'): string[] | null {
	const allowedParts = [DOUBLE_QUOTED_PART, BACKTICK_QUOTED_PART, PLAIN_PART];
	if (kind === 'table') {
		allowedParts.unshift(HYPHENATED_PART);
	}
	const part = `(?:${allowedParts.join('|')})`;
	if (!new RegExp(`^${part}(?:\\.${part})*$`).test(value)) {
		return null;
	}
	return value.match(new RegExp(part, 'g'));
}

function quoteHyphenatedPart(part: string): string {
	return HYPHENATED_PART_REGEX.test(part) ? `\`${part}\`` : part;
}
