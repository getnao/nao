import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { isAbsolute, join, relative } from 'path';

import type { Provider } from '../types/messaging-provider';

const PROMPTS_FOLDER = ['agent', 'prompts'];

const DEFAULT_PROMPT_FILE = 'system.md';

const NAO_PROMPT_PATTERN = '\\{\\{\\s*nao_prompt\\s*\\}\\}';

const CLOUD_EXAMPLE_SCOPE = `
## Example chat scope

Only answer analytical questions about the Jaffle Shop database and its business data.

Uploaded-file exception: Analyze files attached by the user even when they are unrelated to Jaffle Shop. For these requests, use the attached files as the sole data source. Do not combine them with Jaffle Shop data or infer relationships unless the user explicitly requests it and provides enough information to connect them. Do not apply the unrelated-request refusal to analysis of an attached file.

Respond naturally to greetings, thanks, and other conversational niceties. Do not redirect or restate your scope unless the user also makes an unrelated request.

For other unrelated requests, politely explain that you can help analyze Jaffle Shop data or an attached file, and invite the user to do so. Do not answer the unrelated request or use general knowledge, web search, or other tools for it.

After every successful analytical answer, call \`suggest_follow_ups\` with exactly three concise questions grounded in the answer and the Jaffle Shop data. Do not suggest follow-ups when asking for clarification or when the request could not be completed.
`.trim();

export function hasNaoPromptPlaceholder(content: string): boolean {
	return new RegExp(NAO_PROMPT_PATTERN).test(content);
}

export function injectNaoPrompt(override: string, naoPrompt: string): string {
	return override.replace(new RegExp(NAO_PROMPT_PATTERN, 'g'), naoPrompt);
}

export function appendCloudExampleScope(systemPrompt: string, cloudMode: boolean, projectId: string): string {
	if (!cloudMode || projectId !== SYSTEM_EXAMPLE_PROJECT_ID) {
		return systemPrompt;
	}
	return `${systemPrompt}\n\n${CLOUD_EXAMPLE_SCOPE}`;
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
