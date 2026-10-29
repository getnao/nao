import type { LlmSelectedModel } from '@nao/shared/types';

import { isManagedAiEnabled } from '../agents/managed-ai';
import { exampleAgent } from '../agents/profiles/example';
import { onboardingAgent } from '../agents/profiles/onboarding';
import type { DBProject } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import { consumeExampleChatRun, releaseExampleChatRun } from '../queries/example-chat-allowance.queries';
import * as warehouseProvisioningJobQueries from '../queries/warehouse-provisioning-job.queries';
import type { AgentRequest } from '../types/chat';
import type { ExampleChatAllowanceScope } from '../types/example-chat-allowance';
import {
	ExampleChatAllowanceExhaustedError,
	HandlerError,
	OnboardingChatAllowanceExhaustedError,
} from '../utils/error';
import type { AgentRun, AuthorizedAgentRunRequest } from './agent-run';
import { getExampleProjectForUser, getSystemExampleProject } from './example-project';
import { hasConnectedProject } from './warehouse-provisioning';

const EXAMPLE_MODEL = { provider: 'nao', modelId: 'gpt-6-sol' } satisfies LlmSelectedModel;

const UNAVAILABLE_MESSAGES: Record<ExampleChatAllowanceScope, { project: string; afterProjectSetup: string }> = {
	example: {
		project: 'Example project is unavailable',
		afterProjectSetup: 'Example conversations are unavailable after project setup',
	},
	onboarding: {
		project: 'Onboarding is unavailable',
		afterProjectSetup: 'Onboarding conversations are unavailable after project setup',
	},
};

/** Example and onboarding chats run on the example project, free of charge, within a per-user allowance. */
export async function authorizeExampleAgentRun({
	userId,
	body,
	projectId,
}: AuthorizedAgentRunRequest): Promise<AgentRun> {
	if (body.chatId && (await chatQueries.getChatOwnerId(body.chatId)) !== userId) {
		throw new HandlerError('FORBIDDEN', 'Example project access is unavailable');
	}

	const scope = getAllowanceScope(body.mode);
	if (!(await reserveExampleChatRun(userId, scope, body.chatId))) {
		throw new HandlerError('FORBIDDEN', UNAVAILABLE_MESSAGES[scope].afterProjectSetup);
	}

	return {
		projectId,
		profile: body.mode === 'onboarding' ? onboardingAgent : exampleAgent,
		model: isManagedAiEnabled() ? EXAMPLE_MODEL : undefined,
		unbilledManagedAiUsage: true,
		release: () => releaseExampleChatRun(userId, scope),
	};
}

/** Example and onboarding chats always start on the example project; regular chats only fall back to it without a project. */
export async function getExampleProjectForNewChat(
	userId: string,
	mode: AgentRequest['mode'],
): Promise<DBProject | null> {
	if (mode === 'default') {
		return getExampleProjectForUser(userId);
	}
	const project = await getSystemExampleProject();
	if (!project) {
		throw new HandlerError('SERVICE_UNAVAILABLE', UNAVAILABLE_MESSAGES[getAllowanceScope(mode)].project);
	}
	return project;
}

/** Users who already set up a project keep onboarding only while that setup is still running. */
export async function reserveExampleChatRun(
	userId: string,
	scope: ExampleChatAllowanceScope,
	chatId?: string,
): Promise<boolean> {
	const userHasProject = await hasConnectedProject(userId);
	if (userHasProject && !(scope === 'onboarding' && (await isProjectSetupRunning(userId, chatId)))) {
		return false;
	}
	if (!(await consumeExampleChatRun(userId, scope))) {
		throw scope === 'onboarding'
			? new OnboardingChatAllowanceExhaustedError()
			: new ExampleChatAllowanceExhaustedError();
	}
	return true;
}

async function isProjectSetupRunning(userId: string, chatId: string | undefined): Promise<boolean> {
	if (!chatId) {
		return false;
	}
	return Boolean(await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJob(userId, chatId));
}

function getAllowanceScope(mode: AgentRequest['mode']): ExampleChatAllowanceScope {
	return mode === 'onboarding' ? 'onboarding' : 'example';
}
