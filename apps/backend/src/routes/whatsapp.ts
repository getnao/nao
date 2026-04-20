import type { FastifyReply, FastifyRequest } from 'fastify';

import type { App } from '../app';
import { getProjectWhatsappConfig } from '../queries/project-whatsapp-config.queries';
import { whatsappService } from '../services/whatsapp';
import { convertHeaders } from '../utils/utils';

export const whatsappRoutes = async (app: App) => {
	const handleWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
		const { projectId } = request.params as { projectId: string };
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: request.rawBody as string,
		});

		const whatsappConfig = await getProjectWhatsappConfig(projectId);
		if (!whatsappConfig) {
			throw new Error('WhatsApp configuration not found');
		}

		const webhooks = whatsappService.getWebhooks(whatsappConfig);
		if (!webhooks) {
			throw new Error('Failed to initialize WhatsApp webhooks');
		}

		const response = await webhooks.whatsapp(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	};

	app.get('/:projectId', { config: { rawBody: true } }, handleWebhook);
	app.post('/:projectId', { config: { rawBody: true } }, handleWebhook);
};
