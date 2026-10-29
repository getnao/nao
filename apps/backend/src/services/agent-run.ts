import type { LlmSelectedModel } from '@nao/shared/types';

import { adminAgent } from '../agents/profiles/admin';
import { analyticsAgent } from '../agents/profiles/analytics';
import type { AgentProfile } from '../agents/profiles/types';
import type { DBProject } from '../db/abstractSchema';
import { noProjectMessage } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import type { AgentRequest } from '../types/chat';
import { HandlerError } from '../utils/error';
import { isOpenProject } from '../utils/open-projects';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';
import { authorizeExampleAgentRun, getExampleProjectForNewChat } from './example-agent-run';

export interface AgentRunRequest {
	userId: string;
	currentProject: DBProject | null;
	body: AgentRequest;
}

export interface AuthorizedAgentRunRequest extends AgentRunRequest {
	projectId: string;
}

/** A run whose project access and billing are already checked, with the agent profile it may use. */
export interface AgentRun {
	projectId: string;
	profile: AgentProfile;
	model: LlmSelectedModel | undefined;
	unbilledManagedAiUsage: boolean;
	/** Gives back what the run reserved when it fails before streaming. */
	release?: () => Promise<void>;
}

export async function authorizeAgentRun(request: AgentRunRequest): Promise<AgentRun> {
	await assertChatModeMatches(request.body);
	const authorizedRequest = { ...request, projectId: await resolveProjectId(request) };
	return isOpenProject(authorizedRequest.projectId)
		? authorizeExampleAgentRun(authorizedRequest)
		: authorizeMemberAgentRun(authorizedRequest);
}

export function getChatModeMismatchError(requestIsOnboarding: boolean, chatIsOnboarding: boolean): string | null {
	if (requestIsOnboarding === chatIsOnboarding) {
		return null;
	}
	return requestIsOnboarding
		? 'Regular conversations cannot be continued through onboarding'
		: 'Onboarding conversations must be continued through onboarding';
}

async function assertChatModeMatches(body: AgentRequest): Promise<void> {
	if (!body.chatId) {
		return;
	}
	const error = getChatModeMismatchError(body.mode === 'onboarding', await chatQueries.isOnboardingChat(body.chatId));
	if (error) {
		throw new HandlerError('FORBIDDEN', error);
	}
}

async function resolveProjectId({ userId, currentProject, body }: AgentRunRequest): Promise<string> {
	if (body.chatId) {
		const chatProjectId = await chatQueries.getChatProjectId(body.chatId);
		if (!chatProjectId) {
			throw new HandlerError('NOT_FOUND', `Chat with id ${body.chatId} not found.`);
		}
		return chatProjectId;
	}
	if (body.mode === 'default' && currentProject) {
		return currentProject.id;
	}
	const project = await getExampleProjectForNewChat(userId, body.mode);
	if (!project) {
		throw new HandlerError('BAD_REQUEST', noProjectMessage());
	}
	return project.id;
}

async function authorizeMemberAgentRun({ userId, body, projectId }: AuthorizedAgentRunRequest): Promise<AgentRun> {
	if (body.mode !== 'default') {
		throw new HandlerError('FORBIDDEN', `Invalid ${body.mode} conversation`);
	}
	const userRole = await projectQueries.getUserRoleInProject(projectId, userId);
	if (!userRole || userRole === 'viewer') {
		throw new HandlerError('FORBIDDEN', 'Viewers cannot send messages');
	}
	await assertProjectCloudBillingAccess(projectId);
	const canUseAdminAgent = userRole === 'admin' || userRole === 'context_admin';
	return {
		projectId,
		profile: body.adminMode && canUseAdminAgent ? adminAgent : analyticsAgent,
		model: body.model,
		unbilledManagedAiUsage: false,
	};
}
