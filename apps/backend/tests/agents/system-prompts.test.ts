import { existsSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs');

import { getSystemPromptOverride, hasNaoPromptPlaceholder, injectNaoPrompt } from '../../src/agents/system-prompts';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockRealpathSync = vi.mocked(realpathSync);

const ROOT = '/project';
const promptPath = (filename: string) => join(ROOT, 'agent', 'prompts', filename);

function setupPromptFiles(files: Record<string, string>): void {
	mockExistsSync.mockImplementation((path) => Object.keys(files).some((name) => path === promptPath(name)));
	mockRealpathSync.mockImplementation((path) => path as string);
	mockReadFileSync.mockImplementation((path) => {
		const match = Object.entries(files).find(([name]) => path === promptPath(name));
		if (!match) {
			throw new Error(`Unexpected read: ${String(path)}`);
		}
		return match[1] as unknown as ReturnType<typeof readFileSync>;
	});
}

describe('getSystemPromptOverride', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('does not use a surface file for the web Bot', () => {
		setupPromptFiles({ 'slack.md': 'Slack override' });
		expect(getSystemPromptOverride(ROOT)).toBeUndefined();
	});

	it('trims whitespace and ignores empty files', () => {
		setupPromptFiles({ 'system.md': '   \n  Trimmed override \n', 'slack.md': '   \n  ' });
		expect(getSystemPromptOverride(ROOT)).toBe('Trimmed override');
		// slack.md is blank, so slack falls back to system.md
		expect(getSystemPromptOverride(ROOT, 'slack')).toBe('Trimmed override');
	});

	it('returns undefined and logs when reading throws', () => {
		setupPromptFiles({ 'system.md': '' });
		mockReadFileSync.mockImplementation(() => {
			throw new Error('Permission denied');
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(getSystemPromptOverride(ROOT)).toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith('Error reading system prompt override system.md:', expect.any(Error));
	});

	it('refuses to read a prompt that resolves outside the project folder (symlink traversal)', () => {
		setupPromptFiles({ 'system.md': '' });
		mockRealpathSync.mockImplementation((path) =>
			path === promptPath('system.md') ? '/etc/passwd' : (path as string),
		);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(getSystemPromptOverride(ROOT)).toBeUndefined();
		expect(mockReadFileSync).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Refusing to read system prompt override outside the project folder'),
		);
	});
});

describe('hasNaoPromptPlaceholder', () => {
	it('detects the placeholder with varying whitespace', () => {
		expect(hasNaoPromptPlaceholder('before {{ nao_prompt }} after')).toBe(true);
		expect(hasNaoPromptPlaceholder('{{nao_prompt}}')).toBe(true);
		expect(hasNaoPromptPlaceholder('{{   nao_prompt   }}')).toBe(true);
	});

	it('returns false when the placeholder is absent', () => {
		expect(hasNaoPromptPlaceholder('Just my own prompt')).toBe(false);
		expect(hasNaoPromptPlaceholder('{{ other_var }}')).toBe(false);
	});
});

describe('injectNaoPrompt', () => {
	it('replaces every placeholder occurrence with the default prompt', () => {
		const result = injectNaoPrompt('Header\n{{ nao_prompt }}\nFooter {{nao_prompt}}', 'DEFAULT');
		expect(result).toBe('Header\nDEFAULT\nFooter DEFAULT');
	});

	it('leaves content unchanged when there is no placeholder', () => {
		expect(injectNaoPrompt('No placeholder here', 'DEFAULT')).toBe('No placeholder here');
	});
});
