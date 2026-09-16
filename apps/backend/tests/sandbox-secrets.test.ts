import { describe, expect, it } from 'vitest';

import { SystemPrompt } from '../src/components/ai/system-prompt';
import { renderToMarkdown } from '../src/lib/markdown';
import { redactSecretValues, toSandboxEnv } from '../src/utils/sandbox-secrets';

const secrets = [
	{ name: 'OPENWEATHER_API_KEY', value: 'sk-live-0123456789abcdef' },
	{ name: 'SHORT', value: 'ab' },
];

describe('redactSecretValues', () => {
	it('replaces every occurrence of a secret value with a named placeholder', () => {
		const output = 'GET https://api?key=sk-live-0123456789abcdef -> 200\nkey again: sk-live-0123456789abcdef';
		expect(redactSecretValues(output, secrets)).toBe(
			'GET https://api?key=[REDACTED:OPENWEATHER_API_KEY] -> 200\nkey again: [REDACTED:OPENWEATHER_API_KEY]',
		);
	});

	it('leaves values that are too short to be safely masked untouched', () => {
		expect(redactSecretValues('the table has ab rows', secrets)).toBe('the table has ab rows');
	});

	it('masks the longer secret first when one value contains another', () => {
		const nested = [
			{ name: 'TOKEN', value: 'abcd1234' },
			{ name: 'TOKEN_WITH_SUFFIX', value: 'abcd1234-suffix' },
		];
		expect(redactSecretValues('abcd1234-suffix and abcd1234', nested)).toBe(
			'[REDACTED:TOKEN_WITH_SUFFIX] and [REDACTED:TOKEN]',
		);
	});

	it('returns the text unchanged when there is no secret', () => {
		expect(redactSecretValues('hello', [])).toBe('hello');
	});
});

describe('toSandboxEnv', () => {
	it('maps secrets to an environment record keyed by name', () => {
		expect(toSandboxEnv(secrets)).toEqual({ OPENWEATHER_API_KEY: 'sk-live-0123456789abcdef', SHORT: 'ab' });
	});
});

describe('system prompt sandbox secrets block', () => {
	const definitions = [
		{ name: 'OPENWEATHER_API_KEY', description: 'API key for the OpenWeather REST API' },
		{ name: 'INTERNAL_TOKEN', description: null },
	];

	it('lists names and descriptions, never values, when the sandbox tool is available', () => {
		const markdown = renderToMarkdown(
			SystemPrompt({ sandboxSecrets: definitions, toolNames: ['execute_sandboxed_code', 'execute_sql'] }),
		);
		expect(markdown).toContain('## Sandbox Secrets');
		expect(markdown).toContain('**OPENWEATHER_API_KEY** — API key for the OpenWeather REST API');
		expect(markdown).toContain('**INTERNAL_TOKEN**');
		expect(markdown).toContain('os.environ["NAME"]');
		expect(markdown).toContain('[REDACTED:NAME]');
	});

	it('tells the model where secrets are configured when none is defined', () => {
		const markdown = renderToMarkdown(SystemPrompt({ toolNames: ['execute_sandboxed_code'] }));
		expect(markdown).toContain('## Sandbox Secrets');
		expect(markdown).toContain('has not defined any secret');
		expect(markdown).toContain('Settings → Sandbox → Secrets');
	});

	it('is omitted when the sandbox tool is not in the tool set', () => {
		const markdown = renderToMarkdown(SystemPrompt({ sandboxSecrets: definitions, toolNames: ['execute_sql'] }));
		expect(markdown).not.toContain('Sandbox Secrets');
		expect(markdown).not.toContain('OPENWEATHER_API_KEY');
	});
});
