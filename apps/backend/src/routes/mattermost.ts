import type { App } from '../app';
import { mattermostService } from '../services/mattermost';
import { logger } from '../utils/logger';
import { verifyMattermostActionSecret } from '../utils/mattermost-action-secret';
import { createMattermostCallbackResponse, MATTERMOST_CALLBACK_CONTENT_TYPE } from '../utils/mattermost-callback';
import { convertHeaders } from '../utils/utils';

export const mattermostRoutes = async (app: App) => {
	app.post('/:projectId', async (request, reply) => {
		const { projectId } = request.params as { projectId: string };
		const { postId, token } = parseMattermostCallbackBody(request.body);
		if (typeof postId !== 'string' || !verifyMattermostActionSecret(projectId, postId, token)) {
			logger.warn('Rejected Mattermost callback', {
				source: 'http',
				projectId,
				context: { reason: 'invalid-token' },
			});
			return reply.status(200).type(MATTERMOST_CALLBACK_CONTENT_TYPE).send(createMattermostCallbackResponse());
		}

		const adapter = mattermostService.getAdapter(projectId);
		if (!adapter) {
			logger.warn('Rejected Mattermost callback', {
				source: 'http',
				projectId,
				context: { reason: 'adapter-not-running' },
			});
			return reply.status(200).type(MATTERMOST_CALLBACK_CONTENT_TYPE).send(createMattermostCallbackResponse());
		}

		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: JSON.stringify(request.body),
		});
		const response = await adapter.handleWebhook(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		return reply
			.status(response.status)
			.type(MATTERMOST_CALLBACK_CONTENT_TYPE)
			.send(createMattermostCallbackResponse());
	});
};

function parseMattermostCallbackBody(body: unknown): { postId?: unknown; token?: unknown } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return {};
	}
	const { context, post_id: postId } = body as Record<string, unknown>;
	if (!context || typeof context !== 'object' || Array.isArray(context)) {
		return { postId };
	}
	return { postId, token: (context as Record<string, unknown>).token };
}
