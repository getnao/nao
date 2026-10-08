import { createUIMessageStreamResponse } from 'ai';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { assertProjectCloudBillingAccess } from '../services/cloud-billing-access.service';
import {
	getExampleProjectForUser,
	getSystemExampleProject,
	SYSTEM_EXAMPLE_PROJECT_ID,
} from '../services/example-project';
import { posthog, PostHogEvent } from '../services/posthog';
import { AgentRequestSchema } from '../types/chat';

const DEBUG_CHUNKS = false;

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: AgentRequestSchema } }, async (request, reply) => {
		const { user, project, body, headers } = request;

		const isOnboarding = body.mode === 'onboarding';
		const isExampleMode = body.mode === 'example';
		const chatModeError = body.chatId
			? getChatModeMismatchError(isOnboarding, await chatQueries.isOnboardingChat(body.chatId))
			: null;
		if (chatModeError) {
			return reply.status(403).send({ error: chatModeError });
		}

		const onboardingProject = isOnboarding ? await projectQueries.getProjectById(SYSTEM_EXAMPLE_PROJECT_ID) : null;

		const exampleProject =
			!isOnboarding && (isExampleMode || !project)
				? isExampleMode
					? await getSystemExampleProject()
					: await getExampleProjectForUser(user.id)
				: null;

		const projectId = body.chatId
			? await chatQueries.getChatProjectId(body.chatId)
			: isOnboarding
				? onboardingProject?.id
				: isExampleMode
					? exampleProject?.id
					: (project?.id ?? exampleProject?.id);

		if (isExampleMode && projectId !== SYSTEM_EXAMPLE_PROJECT_ID) {
			return reply
				.status(body.chatId ? 403 : 503)
				.send({ error: body.chatId ? 'Invalid example conversation' : 'Example project is unavailable' });
		}

		const isExampleProject = projectId === SYSTEM_EXAMPLE_PROJECT_ID;
		const exampleChatOwnerId =
			isExampleProject && body.chatId ? await chatQueries.getChatOwnerId(body.chatId) : undefined;

		let canChatWithNaoData = false;
		if (isOnboarding) {
			if (!onboardingProject) {
				return reply.status(503).send({ error: 'Onboarding is unavailable' });
			}
			if (projectId !== SYSTEM_EXAMPLE_PROJECT_ID && !body.chatId) {
				return reply.status(403).send({ error: 'Invalid onboarding conversation' });
			}
		} else if (isExampleProject) {
			if (
				!canAccessExampleChat({
					chatId: body.chatId,
					chatOwnerId: exampleChatOwnerId,
					userId: user.id,
					exampleProjectAvailable: exampleProject?.id === SYSTEM_EXAMPLE_PROJECT_ID,
				})
			) {
				return reply.status(403).send({ error: 'Example project access is unavailable' });
			}
		} else if (projectId) {
			const userRole = await projectQueries.getUserRoleInProject(projectId, user.id);
			if (!userRole || userRole === 'viewer') {
				return reply.status(403).send({ error: 'Viewers cannot send messages' });
			}
			canChatWithNaoData = userRole === 'admin' || userRole === 'context_admin';
			await assertProjectCloudBillingAccess(projectId);
		}

		const result = await handleAgentRoute({
			userId: user.id,
			projectId,
			...body,
			adminMode: body.adminMode && canChatWithNaoData,
			projectAccessAlreadyAuthorized: isExampleProject,
		});

		posthog.capture(user.id, PostHogEvent.MessageSent, {
			project_id: projectId,
			chat_id: result.chatId,
			model_id: result.modelId,
			is_new_chat: result.isNewChat,
			source: isOnboarding ? 'onboarding' : body.adminMode && canChatWithNaoData ? 'admin' : 'web',
			domain_host: headers['x-forwarded-host'] || headers.host,
		});

		let stream = result.stream;

		if (DEBUG_CHUNKS) {
			stream = stream.pipeThrough(
				new TransformStream({
					transform: async (chunk, controller) => {
						console.log(chunk);
						controller.enqueue(chunk);
						await new Promise((resolve) => setTimeout(resolve, 100));
					},
				}),
			);
		}

		return createUIMessageStreamResponse({
			stream,
			headers: {
				// Disable nginx buffering for streaming responses
				// This is critical for proper stream termination behind reverse proxies
				'X-Accel-Buffering': 'no',
				'Cache-Control': 'no-cache, no-transform',
			},
		});
	});
};

export function getChatModeMismatchError(requestIsOnboarding: boolean, chatIsOnboarding: boolean): string | null {
	if (requestIsOnboarding === chatIsOnboarding) {
		return null;
	}
	return requestIsOnboarding
		? 'Regular conversations cannot be continued through onboarding'
		: 'Onboarding conversations must be continued through onboarding';
}

export function canAccessExampleChat({
	chatId,
	chatOwnerId,
	userId,
	exampleProjectAvailable,
}: {
	chatId: string | undefined;
	chatOwnerId: string | undefined;
	userId: string;
	exampleProjectAvailable: boolean;
}): boolean {
	return chatId ? chatOwnerId === userId : exampleProjectAvailable;
}
