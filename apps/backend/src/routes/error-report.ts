import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { App } from '../app';
import { env } from '../env';
import { authMiddleware } from '../middleware/auth';
import { sendErrorReport } from '../services/error-report';

const REPORT_LIMIT = 5;
const SELF_HOSTED_GLOBAL_REPORT_LIMIT = 100;
const REPORT_WINDOW_MS = 60_000;

interface ReportWindow {
	count: number;
	resetAt: number;
}

interface ReportRateLimit {
	key: string;
	limit: number;
}

const errorReportSchema = z.object({
	message: z.string().trim().min(1).max(2_000),
	stack: z.string().max(20_000).optional(),
	pageUrl: z.url().max(2_048),
});

export const errorReportRoutes = async (app: App) => {
	// ponytail: process-local limits protect one backend process; use a shared store before running replicas.
	const reportWindows = new Map<string, ReportWindow>();
	const cleanupInterval = setInterval(() => removeExpiredReportWindows(reportWindows), REPORT_WINDOW_MS);
	cleanupInterval.unref();
	app.addHook('onClose', (_app, done) => {
		clearInterval(cleanupInterval);
		done();
	});

	app.post(
		'/',
		{
			bodyLimit: 32 * 1024,
			preHandler: (request, reply) => protectErrorReport(request, reply, reportWindows),
			schema: { body: errorReportSchema },
		},
		async (request, reply) => {
			if (!(await sendErrorReport(request.body))) {
				return reply.status(502).send({ error: 'The error report could not be sent.' });
			}

			return reply.status(204).send();
		},
	);
};

async function protectErrorReport(
	request: FastifyRequest,
	reply: FastifyReply,
	reportWindows: Map<string, ReportWindow>,
): Promise<void> {
	let limits: ReportRateLimit[];
	if (env.NAO_MODE === 'cloud') {
		await authMiddleware(request, reply);
		if (reply.sent) {
			return;
		}
		limits = [{ key: `cloud:user:${request.user.id}`, limit: REPORT_LIMIT }];
	} else {
		limits = [
			{ key: 'self-hosted:global', limit: SELF_HOSTED_GLOBAL_REPORT_LIMIT },
			{ key: `self-hosted:ip:${request.ip}`, limit: REPORT_LIMIT },
		];
	}
	const now = Date.now();
	const retryAfter = consumeReportLimits(reportWindows, limits, now);
	if (retryAfter === undefined) {
		return;
	}

	reply.header('retry-after', retryAfter).status(429).send({ error: 'Too many error reports. Try again later.' });
}

function consumeReportLimits(
	reportWindows: Map<string, ReportWindow>,
	limits: ReportRateLimit[],
	now: number,
): number | undefined {
	const blockedWindows = limits.flatMap(({ key, limit }) => {
		const window = reportWindows.get(key);
		return window && window.resetAt > now && window.count >= limit ? [window] : [];
	});
	if (blockedWindows.length > 0) {
		return Math.max(...blockedWindows.map((window) => Math.ceil((window.resetAt - now) / 1_000)));
	}

	for (const { key } of limits) {
		const window = reportWindows.get(key);
		if (!window || window.resetAt <= now) {
			reportWindows.set(key, { count: 1, resetAt: now + REPORT_WINDOW_MS });
		} else {
			window.count += 1;
		}
	}
	return undefined;
}

function removeExpiredReportWindows(reportWindows: Map<string, ReportWindow>): void {
	const now = Date.now();
	for (const [key, window] of reportWindows) {
		if (window.resetAt <= now) {
			reportWindows.delete(key);
		}
	}
}
