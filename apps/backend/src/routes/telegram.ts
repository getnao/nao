import type { App } from '../app';
import { getTelegramConfig } from '../queries/project-telegram-config.queries';
import { telegramService } from '../services/telegram';
import { convertHeaders } from '../utils/utils';

export const telegramRoutes = async (app: App) => {
	app.post('/:projectId', async (request, reply) => {
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: JSON.stringify(request.body),
		});

		const telegramConfig = await getTelegramConfig();
		if (!telegramConfig) {
			throw new Error('Telegram configuration not found');
		}

		const webhooks = telegramService.getWebhooks(telegramConfig);
		if (!webhooks) {
			throw new Error('Failed to initialize Telegram webhooks');
		}

		const response = await webhooks.telegram(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};
