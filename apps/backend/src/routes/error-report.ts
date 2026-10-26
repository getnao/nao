import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { App } from '../app';
import { env } from '../env';
import { authMiddleware } from '../middleware/auth';
import { sendErrorReport } from '../services/error-report';

const CLOUD_REPORT_LIMIT = 5;
const CLOUD_REPORT_WINDOW_MS = 60_000;
const cloudReportWindows = new Map<string, { count: number; resetAt: number }>();

const errorReportSchema = z.object({
	message: z.string().trim().min(1).max(2_000),
	stack: z.string().max(20_000).optional(),
	pageUrl: z.url().max(2_048),
});

export const errorReportRoutes = async (app: App) => {
	app.post(
		'/',
		{ bodyLimit: 32 * 1024, preHandler: protectCloudErrorReport, schema: { body: errorReportSchema } },
		async (request, reply) => {
			if (!(await sendErrorReport(request.body))) {
				return reply.status(502).send({ error: 'The error report could not be sent.' });
			}

			return reply.status(204).send();
		},
	);
};

async function protectCloudErrorReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
	if (env.NAO_MODE !== 'cloud') {
		return;
	}

	await authMiddleware(request, reply);
	if (reply.sent) {
		return;
	}

	const now = Date.now();
	const window = cloudReportWindows.get(request.user.id);
	if (!window || window.resetAt <= now) {
		cloudReportWindows.set(request.user.id, { count: 1, resetAt: now + CLOUD_REPORT_WINDOW_MS });
		return;
	}

	if (window.count >= CLOUD_REPORT_LIMIT) {
		reply
			.header('retry-after', Math.ceil((window.resetAt - now) / 1_000))
			.status(429)
			.send({ error: 'Too many error reports. Try again later.' });
		return;
	}

	// ponytail: process-local limiting is sufficient for one active cloud backend; use a shared store for replicas.
	window.count += 1;
}
