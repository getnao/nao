import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import type { Provider } from '../types/messaging-provider';

const PROMPTS_FOLDER = ['agent', 'prompts'];

const DEFAULT_PROMPT_FILE = 'system.md';

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
		const content = readFileSync(filePath, 'utf-8').trim();
		return content.length > 0 ? content : undefined;
	} catch (error) {
		console.error(`Error reading system prompt override ${filename}:`, error);
		return undefined;
	}
}
