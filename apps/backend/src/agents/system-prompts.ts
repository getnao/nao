import { existsSync, readFileSync, realpathSync } from 'fs';
import { isAbsolute, join, relative } from 'path';

import type { Provider } from '../types/messaging-provider';

const PROMPTS_FOLDER = ['agent', 'prompts'];

const DEFAULT_PROMPT_FILE = 'system.md';

const NAO_PROMPT_PATTERN = '\\{\\{\\s*nao_prompt\\s*\\}\\}';

export function hasNaoPromptPlaceholder(content: string): boolean {
	return new RegExp(NAO_PROMPT_PATTERN).test(content);
}

export function injectNaoPrompt(override: string, naoPrompt: string): string {
	return override.replace(new RegExp(NAO_PROMPT_PATTERN, 'g'), naoPrompt);
}

function getPromptFileCandidates(provider?: Provider): string[] {
	if (!provider) {
		return [DEFAULT_PROMPT_FILE];
	}
	return [`${provider}.md`, DEFAULT_PROMPT_FILE];
}

export function getSystemPromptOverride(projectFolder: string, provider?: Provider): string | undefined {
	for (const filename of getPromptFileCandidates(provider)) {
		const content = readPromptFile(projectFolder, filename);
		if (content) {
			return content;
		}
	}
	return undefined;
}

function readPromptFile(projectFolder: string, filename: string): string | undefined {
	const filePath = join(projectFolder, ...PROMPTS_FOLDER, filename);
	if (!existsSync(filePath)) {
		return undefined;
	}

	try {
		const realFilePath = realpathSync(filePath);
		if (!isWithinDirectory(realpathSync(projectFolder), realFilePath)) {
			console.error(`Refusing to read system prompt override outside the project folder: ${filename}`);
			return undefined;
		}
		const content = readFileSync(realFilePath, 'utf-8').trim();
		return content.length > 0 ? content : undefined;
	} catch (error) {
		console.error(`Error reading system prompt override ${filename}:`, error);
		return undefined;
	}
}

function isWithinDirectory(directory: string, target: string): boolean {
	const rel = relative(directory, target);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
