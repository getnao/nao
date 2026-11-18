import type { ResolvedSandboxSecret } from '../services/sandbox-secret.service';

export function redactedPlaceholder(name: string): string {
	return `[REDACTED:${name}]`;
}

export function toSandboxEnv(secrets: ResolvedSandboxSecret[]): Record<string, string> {
	return Object.fromEntries(secrets.map(({ name, value }) => [name, value]));
}

/**
 * Masks every occurrence of a secret value in text the model will read. Code the model writes can
 * still print a secret on purpose; this keeps it from reaching the model by accident.
 *
 * All values are matched in a single pass over the original text, longest first, so a placeholder
 * produced for one secret is never itself scanned for another.
 */
export function redactSecretValues(text: string, secrets: ResolvedSandboxSecret[]): string {
	const redactable = secrets.filter(({ value }) => value.length > 0);
	if (redactable.length === 0) {
		return text;
	}

	const placeholderByValue = new Map(redactable.map(({ name, value }) => [value, redactedPlaceholder(name)]));
	const alternation = [...placeholderByValue.keys()]
		.sort((a, b) => b.length - a.length)
		.map(escapeRegExp)
		.join('|');

	return text.replace(new RegExp(alternation, 'g'), (match) => placeholderByValue.get(match) ?? match);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
