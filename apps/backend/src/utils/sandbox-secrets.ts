import type { ResolvedSandboxSecret } from '../services/sandbox-secret.service';

/** Values shorter than this are too likely to appear in output by coincidence to be worth masking. */
const MIN_REDACTABLE_LENGTH = 4;

export function redactedPlaceholder(name: string): string {
	return `[REDACTED:${name}]`;
}

export function toSandboxEnv(secrets: ResolvedSandboxSecret[]): Record<string, string> {
	return Object.fromEntries(secrets.map(({ name, value }) => [name, value]));
}

/**
 * Masks every occurrence of a secret value in text the model will read. Code the model writes can
 * still print a secret on purpose; this keeps it from reaching the model by accident.
 */
export function redactSecretValues(text: string, secrets: ResolvedSandboxSecret[]): string {
	const redactable = secrets
		.filter(({ value }) => value.length >= MIN_REDACTABLE_LENGTH)
		.sort((a, b) => b.value.length - a.value.length);

	return redactable.reduce((redacted, { name, value }) => {
		return redacted.split(value).join(redactedPlaceholder(name));
	}, text);
}
