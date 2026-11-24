import { TRPCError } from '@trpc/server';
import { generateText } from 'ai';

import { disableModelReasoning, getProviderMeta } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import { resolveUserBackgroundModel } from './background-model.service';
import { type ContextExplorerGitContext, readContextChangesPatch } from './context-explorer-git.service';

const MAX_PATCH_LENGTH = 12_000;
const MAX_MESSAGE_LENGTH = 120;
const MAX_OUTPUT_TOKENS = 60;

const SYSTEM_PROMPT = [
	'You write git commit messages for changes to the context of an analytics agent: docs, rules, metrics and table descriptions.',
	'Answer with one line in the imperative mood, under 72 characters, saying what changed for the agent, without a trailing period.',
	'Answer with the message alone, without quotes, prefixes or explanations.',
].join(' ');

export async function generateContextCommitMessage(
	context: ContextExplorerGitContext,
	paths: string[],
): Promise<string> {
	const patch = await readContextChangesPatch(context, paths, MAX_PATCH_LENGTH);
	if (!patch.trim()) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'None of these files has changes to describe.' });
	}
	const { projectId, userId } = context;
	const modelConfig = await resolveUserBackgroundModel({
		projectId,
		userId,
		defaultCategory: 'other',
		preferredModelId: ({ provider }) => getProviderMeta(provider).summaryModelId,
		usageContext: { userId, projectId, category: 'title' },
	});
	if (!modelConfig) {
		throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Set up a model for this project first.' });
	}
	const { text } = await generateText({
		...disableModelReasoning(modelConfig.provider, modelConfig.model),
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: patch }],
		maxOutputTokens: MAX_OUTPUT_TOKENS,
		experimental_telemetry: llmTelemetry('nao-context-commit-message', { projectId }),
	});
	return sanitizeCommitMessage(text);
}

export function sanitizeCommitMessage(text: string): string {
	const firstLine = text.trim().split('\n')[0] ?? '';
	return firstLine
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/\.$/, '')
		.trim()
		.slice(0, MAX_MESSAGE_LENGTH);
}
