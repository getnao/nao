import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSystemPromptOverride, hasNaoPromptPlaceholder, injectNaoPrompt } from '../src/agents/system-prompts';

describe('getSystemPromptOverride (real filesystem)', () => {
	let projectFolder: string;

	beforeEach(() => {
		projectFolder = mkdtempSync(join(tmpdir(), 'nao-prompts-'));
		mkdirSync(join(projectFolder, 'agent', 'prompts'), { recursive: true });
	});

	afterEach(() => {
		rmSync(projectFolder, { recursive: true, force: true });
	});

	function writePrompt(filename: string, content: string): void {
		writeFileSync(join(projectFolder, 'agent', 'prompts', filename), content, 'utf-8');
	}

	it('returns undefined for an empty prompts folder', () => {
		expect(getSystemPromptOverride(projectFolder)).toBeUndefined();
		expect(getSystemPromptOverride(projectFolder, 'slack')).toBeUndefined();
	});

	it('loads system.md for the web Bot and as the global fallback', () => {
		writePrompt('system.md', 'You are the org default analyst.');

		expect(getSystemPromptOverride(projectFolder)).toBe('You are the org default analyst.');
		expect(getSystemPromptOverride(projectFolder, 'slack')).toBe('You are the org default analyst.');
		expect(getSystemPromptOverride(projectFolder, 'teams')).toBe('You are the org default analyst.');
	});

	it('loads a surface-specific prompt and prefers it over system.md', () => {
		writePrompt('system.md', 'Global prompt');
		writePrompt('slack.md', 'Slack-only prompt');

		expect(getSystemPromptOverride(projectFolder, 'slack')).toBe('Slack-only prompt');
		expect(getSystemPromptOverride(projectFolder, 'teams')).toBe('Global prompt');
		expect(getSystemPromptOverride(projectFolder)).toBe('Global prompt');
	});

	it('ignores a README.md (not a recognized surface file)', () => {
		writePrompt('README.md', '# How to use prompts');

		expect(getSystemPromptOverride(projectFolder)).toBeUndefined();
		expect(getSystemPromptOverride(projectFolder, 'slack')).toBeUndefined();
	});

	it('refuses to follow a symlink that points outside the project folder', () => {
		const secretDir = mkdtempSync(join(tmpdir(), 'nao-secret-'));
		const secretFile = join(secretDir, 'secret.md');
		writeFileSync(secretFile, 'TOP SECRET HOST FILE', 'utf-8');
		symlinkSync(secretFile, join(projectFolder, 'agent', 'prompts', 'system.md'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		try {
			expect(getSystemPromptOverride(projectFolder)).toBeUndefined();
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Refusing to read system prompt override outside the project folder'),
			);
		} finally {
			consoleSpy.mockRestore();
			rmSync(secretDir, { recursive: true, force: true });
		}
	});

	it('composes the default prompt into a file that keeps the {{ nao_prompt }} placeholder', () => {
		writePrompt('slack.md', '{{ nao_prompt }}\n\n## House rules\n- Answer in EUR.');

		const override = getSystemPromptOverride(projectFolder, 'slack');
		expect(override).toBeDefined();
		expect(hasNaoPromptPlaceholder(override!)).toBe(true);

		const composed = injectNaoPrompt(override!, 'DEFAULT_SLACK_PROMPT');
		expect(composed).toBe('DEFAULT_SLACK_PROMPT\n\n## House rules\n- Answer in EUR.');
	});
});
