import {
	type StoryLlmRequest,
	type StoryLlmResult,
	type StoryModel,
	type StoryModelRequest,
	type StoryModelResult,
	toStoryModelId,
} from '@nao/shared/story-models';
import { isSameModel } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import { storyModelAgent } from '../agents/profiles/story-model';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { ForkMetadata } from '../types/chat';
import { getProjectAvailableModels, resolveDefaultChatModel } from '../utils/llm';
import { agentService } from './agent';
import { CustomStoryNotFoundError } from './custom-story';

export interface CustomStoryModelTarget {
	projectId: string;
	storyId: string;
	/** The user looking at the story: the call runs as them, under their budget and their user groups. */
	viewerId: string;
	billingAccessVerifiedProjectId?: string;
}

/** A model that cannot answer is the story's content, like a failing query: its reason reaches the frame. */
export class CustomStoryModelError extends Error {}

const MODEL_CALLER_ROLES = ['admin', 'user', 'context_admin'];

/** The models a story can call for this viewer: the LLMs their chat offers, none for members who cannot chat. */
export async function listCustomStoryModels(projectId: string, viewerId: string): Promise<StoryModel[]> {
	if (!(await canCallModels(projectId, viewerId))) {
		return [];
	}
	const [available, defaultModel] = await Promise.all([
		getProjectAvailableModels(projectId),
		resolveDefaultChatModel(projectId),
	]);
	return available.map((model) => ({
		kind: 'llm',
		id: toStoryModelId(model),
		provider: model.provider,
		modelId: model.modelId,
		name: model.name,
		isDefault: defaultModel !== null && isSameModel(model, defaultModel),
	}));
}

export async function runCustomStoryModel(
	target: CustomStoryModelTarget,
	request: StoryModelRequest,
): Promise<StoryModelResult> {
	switch (request.kind) {
		case 'llm':
			return runStoryLlm(target, request);
	}
}

/**
 * Runs through the agent like a chat message, as the viewer: the call is saved as a chat of its own (kept under the
 * story, out of the chat history) with its cost, so budgets, billing, user groups and usage reports all see it.
 */
async function runStoryLlm(target: CustomStoryModelTarget, request: StoryLlmRequest): Promise<StoryLlmResult> {
	if (!(await canCallModels(target.projectId, target.viewerId))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot perform this action' });
	}
	await assertCustomStoryInProject(target.storyId, target.projectId);
	const model = await agentService.resolveModelSelection(
		target.projectId,
		await findRequestedLlm(target.projectId, request.model),
	);
	const chat = await createStoryModelChat(target, request.prompt);
	const agent = await agentService.create(chat, model, storyModelAgent(request), {
		billingAccessVerifiedProjectId: target.billingAccessVerifiedProjectId,
	});

	try {
		const result = await agent.streamToCompletion(chat.messages);
		return {
			kind: 'llm',
			model: toStoryModelId(model),
			text: result.text,
			...(request.schema && { object: result.output }),
		};
	} catch (error) {
		throw new CustomStoryModelError(error instanceof Error ? error.message : String(error));
	}
}

async function createStoryModelChat(target: CustomStoryModelTarget, prompt: string) {
	const story = await storyReferenceQueries.getReferenceableStory(target.viewerId, target.projectId, target.storyId);
	const forkMetadata: ForkMetadata = {
		type: chatQueries.STORY_MODEL_FORK_TYPE,
		id: target.storyId,
		title: story?.title ?? '',
		authorName: story?.authorName ?? '',
	};
	const [created] = await chatQueries.createChat(
		{ projectId: target.projectId, userId: target.viewerId, title: forkMetadata.title, forkMetadata },
		{ text: prompt, source: 'storyModel' },
	);
	const [chat] = await chatQueries.getChat(created.id);
	if (!chat) {
		throw new Error(`Failed to load story model chat ${created.id}`);
	}
	return { ...chat, projectId: target.projectId, userId: target.viewerId };
}

/** Every route funnels here, so a share link or id of a classic story or another project's story is refused alike. */
async function assertCustomStoryInProject(storyId: string, projectId: string): Promise<void> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story || story.format !== 'custom' || story.projectId !== projectId) {
		throw new CustomStoryNotFoundError();
	}
}

async function canCallModels(projectId: string, userId: string): Promise<boolean> {
	const role = await projectQueries.getUserRoleInProject(projectId, userId);
	return role !== null && role !== undefined && MODEL_CALLER_ROLES.includes(role);
}

/** Only models the project offers can be called: a story cannot reach a provider or model the chat does not list. */
async function findRequestedLlm(projectId: string, modelId: string | undefined) {
	if (modelId === undefined) {
		return undefined;
	}
	const model = (await getProjectAvailableModels(projectId)).find(
		(candidate) => toStoryModelId(candidate) === modelId,
	);
	if (!model) {
		throw new CustomStoryModelError(
			`Model ${modelId} is not available in this project. List them with useModels().`,
		);
	}
	return { provider: model.provider, modelId: model.modelId };
}
