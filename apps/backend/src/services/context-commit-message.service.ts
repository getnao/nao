import type { LlmProvider } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { generateText } from 'ai';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { type ContextExplorerGitContext, readContextChangesPatch } from './context-explorer-git.service';

const MAX_PATCH_LENGTH = 12_000;
const MAX_MESSAGE_LENGTH = 120;
const MAX_OUTPUT_TOKENS = 60;

const SYSTEM_PROMPT = [
	'You write git commit messages for changes to the context of an analytics agent: docs, rules, metrics and table descriptions.',
	'Answer with one line in the imperative mood, under 72 characters, saying what changed for the agent, without a trailing period.',
	'Answer with the message alone, without quotes, prefixes or explanations.',
].join(' ');

/** A one-line commit message for the given changed files, written by the project's model from their diff. */
export async function generateContextCommitMessage(
	context: ContextExplorerGitContext,
	paths: string[],
): Promise<string> {
	const patch = await readContextChangesPatch(context, paths, MAX_PATCH_LENGTH);
	if (!patch.trim()) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'None of these files has changes to describe.' });
	}
	const modelConfig = await resolveModelForProject(context.projectId, context.userId);
	if (!modelConfig) {
		throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Set up a model for this project first.' });
	}
	const { text } = await generateText({
		...disableModelReasoning(modelConfig.provider, modelConfig.model),
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: patch }],
		maxOutputTokens: MAX_OUTPUT_TOKENS,
		experimental_telemetry: llmTelemetry('nao-context-commit-message', { projectId: context.projectId }),
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

async function resolveModelForProject(
	projectId: string,
	userId: string,
): Promise<{ provider: LlmProvider; model: ProviderModelResult } | null> {
	const pinned = await resolveDefaultModelSelection(projectId, 'other');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}
	const modelId = pinned?.modelId ?? getProviderMeta(provider).summaryModelId;
	const model = await resolveProviderModel(projectId, provider, modelId, false, {
		userId,
		projectId,
		category: 'title',
	});
	return model ? { provider, model } : null;
}
