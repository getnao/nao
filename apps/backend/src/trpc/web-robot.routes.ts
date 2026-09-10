import {
	emptyWebRobotRunStats,
	webRobotBrowserActionSchema,
	webRobotBrowserCaptureSchema,
	webRobotRecipeSchema,
} from '@nao/shared/web-robot';
import { TRPCError } from '@trpc/server';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod/v4';

import { env } from '../env';
import { requestWebRobotCancellation, WEB_ROBOT_JOB_NAME, webRobotJobUniqueKey } from '../handlers/web-robot.handler';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import type { WebRobotWithSchedule } from '../queries/web-robot.queries';
import * as webRobotQueries from '../queries/web-robot.queries';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { nextCronTick } from '../services/scheduler.service';
import { isStorageEnabled, STORAGE_DISABLED_MESSAGE } from '../services/storage';
import { inspectWebRobotUrl, runWebRobotRecipe } from '../services/web-scraper';
import { webRobotDefinitionHash } from '../services/web-scraper/definition';
import { contextAdminProtectedProcedure } from './trpc';

const assertWebRobotsEnabled = () => {
	if (!env.BETA_WEB_ROBOTS_ENABLED) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Web robots are disabled on this instance.' });
	}
	if (!isStorageEnabled()) {
		throw new TRPCError({ code: 'PRECONDITION_FAILED', message: STORAGE_DISABLED_MESSAGE });
	}
};

const webRobotProcedure = contextAdminProtectedProcedure.use(async ({ next }) => {
	assertWebRobotsEnabled();
	return next();
});

const slugSchema = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only');

const httpUrlSchema = z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
	message: 'Enter a valid HTTP or HTTPS URL',
});

const writeWebRobotSchema = z.object({
	name: z.string().trim().min(1).max(255),
	slug: slugSchema.optional(),
	description: z.string().trim().max(2000).optional(),
	recipe: webRobotRecipeSchema,
	cron: z.string().trim().default(''),
	enabled: z.boolean().default(true),
});

const createWebRobotSchema = writeWebRobotSchema;
const updateWebRobotSchema = writeWebRobotSchema.omit({ slug: true }).extend({ id: z.string() });

export const webRobotRoutes = {
	list: webRobotProcedure.query(async ({ ctx }) => {
		return webRobotQueries.listWebRobots(ctx.project.id);
	}),

	get: webRobotProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const robot = await webRobotQueries.getWebRobot(ctx.project.id, input.id);
		if (!robot) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${input.id}` });
		}
		return robot;
	}),

	create: webRobotProcedure.input(createWebRobotSchema).mutation(async ({ ctx, input }) => {
		assertValidCron(input.cron);
		const slug = input.slug ?? slugify(input.name);
		const recipe = webRobotRecipeSchema.parse(input.recipe);
		const robot = await webRobotQueries
			.createWebRobot({
				projectId: ctx.project.id,
				userId: ctx.user.id,
				name: input.name,
				slug,
				description: input.description || null,
				definition: recipe,
				definitionVersion: recipe.version,
				definitionHash: webRobotDefinitionHash(recipe),
			})
			.catch((error) => {
				if (isUniqueViolation(error)) {
					throw new TRPCError({ code: 'CONFLICT', message: `A web robot named '${slug}' already exists.` });
				}
				throw error;
			});
		return syncWebRobotJob(robot.id, input.cron, input.enabled);
	}),

	update: webRobotProcedure.input(updateWebRobotSchema).mutation(async ({ ctx, input }) => {
		assertValidCron(input.cron);
		const recipe = webRobotRecipeSchema.parse(input.recipe);
		const robot = await webRobotQueries.updateWebRobot(ctx.project.id, input.id, {
			name: input.name,
			description: input.description || null,
			definition: recipe,
			definitionVersion: recipe.version,
			definitionHash: webRobotDefinitionHash(recipe),
		});
		if (!robot) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${input.id}` });
		}
		return syncWebRobotJob(robot.id, input.cron, input.enabled);
	}),

	archive: webRobotProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const robot = await webRobotQueries.getWebRobot(ctx.project.id, input.id);
		if (!robot) {
			return { success: true };
		}
		const activeRuns = await webRobotQueries.listActiveWebRobotRuns(robot.id);
		for (const activeRun of activeRuns) {
			if (activeRun.scheduledJobId) {
				await scheduledJobQueries.deleteJob(activeRun.scheduledJobId);
			}
			if (activeRun.status === 'queued') {
				await webRobotQueries.cancelQueuedWebRobotRun(activeRun.id);
				continue;
			}
			await webRobotQueries.requestWebRobotRunCancel(activeRun.id);
			requestWebRobotCancellation(activeRun.id);
		}
		if (robot.scheduledJobId) {
			await scheduledJobQueries.deleteJob(robot.scheduledJobId);
		}
		await webRobotQueries.archiveWebRobot(ctx.project.id, robot.id);
		return { success: true };
	}),

	setEnabled: webRobotProcedure
		.input(z.object({ id: z.string(), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const robot = await webRobotQueries.getWebRobot(ctx.project.id, input.id);
			if (!robot) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${input.id}` });
			}
			return syncWebRobotJob(robot.id, robot.cron ?? '', input.enabled);
		}),

	inspectUrl: webRobotProcedure
		.input(
			z.object({
				url: httpUrlSchema.max(4096),
				loader: z.enum(['http', 'browser']).default('http'),
				allowedHosts: z.array(z.string().trim().min(1)).optional(),
				selectors: z.array(z.string().trim().min(1)).max(32).default([]),
				actions: z.array(webRobotBrowserActionSchema).max(32).default([]),
				capture: z.array(webRobotBrowserCaptureSchema).max(16).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const hostname = new URL(input.url).hostname;
			return inspectWebRobotUrl({
				url: input.url,
				loader: input.loader,
				allowedHosts: input.allowedHosts ?? [hostname],
				selectors: input.selectors,
				actions: input.actions,
				capture: input.capture,
				env: await projectQueries.getEnvVars(ctx.project.id),
			});
		}),

	testRecipe: webRobotProcedure.input(z.object({ recipe: webRobotRecipeSchema })).mutation(async ({ ctx, input }) => {
		return runWebRobotRecipe({
			recipe: webRobotRecipeSchema.parse(input.recipe),
			env: await projectQueries.getEnvVars(ctx.project.id),
			dryRun: true,
		});
	}),

	runNow: webRobotProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const robot = await webRobotQueries.getWebRobot(ctx.project.id, input.id);
		if (!robot) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${input.id}` });
		}
		const activeRun = await webRobotQueries.findActiveWebRobotRun(robot.id);
		if (activeRun) {
			throw new TRPCError({ code: 'CONFLICT', message: 'This web robot already has an active run.' });
		}

		const run = await webRobotQueries.createWebRobotRun({
			robotId: robot.id,
			triggeredByUserId: ctx.user.id,
			trigger: 'manual',
			definition: robot.definition,
			definitionHash: robot.definitionHash,
			stats: emptyWebRobotRunStats(),
		});
		const job = await scheduledJobQueries.enqueueOnceJob({
			name: WEB_ROBOT_JOB_NAME,
			payload: { webRobotId: robot.id, runId: run.id },
			uniqueKey: `web-robot-manual:${run.id}`,
			maxAttempts: 1,
		});
		if (!job) {
			await webRobotQueries.cancelQueuedWebRobotRun(run.id);
			throw new TRPCError({ code: 'CONFLICT', message: 'This web robot run is already queued.' });
		}
		await webRobotQueries.setWebRobotRunScheduledJob(run.id, job.id);
		return webRobotQueries.getWebRobotRun(ctx.project.id, run.id);
	}),

	listRuns: webRobotProcedure
		.input(z.object({ id: z.string(), limit: z.number().int().min(1).max(100).default(20) }))
		.query(async ({ ctx, input }) => {
			await requireWebRobot(ctx.project.id, input.id);
			return webRobotQueries.listWebRobotRuns(ctx.project.id, input.id, input.limit);
		}),

	getRun: webRobotProcedure.input(z.object({ runId: z.string() })).query(async ({ ctx, input }) => {
		const run = await webRobotQueries.getWebRobotRun(ctx.project.id, input.runId);
		if (!run) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot run not found: ${input.runId}` });
		}
		return run;
	}),

	cancelRun: webRobotProcedure.input(z.object({ runId: z.string() })).mutation(async ({ ctx, input }) => {
		const run = await webRobotQueries.getWebRobotRun(ctx.project.id, input.runId);
		if (!run) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot run not found: ${input.runId}` });
		}
		if (run.status === 'queued') {
			if (run.scheduledJobId && run.trigger === 'manual') {
				await scheduledJobQueries.deleteJob(run.scheduledJobId);
			}
			await webRobotQueries.cancelQueuedWebRobotRun(run.id);
			return webRobotQueries.getWebRobotRun(ctx.project.id, run.id);
		}
		if (run.status !== 'running') {
			return run;
		}
		await webRobotQueries.requestWebRobotRunCancel(run.id);
		requestWebRobotCancellation(run.id);
		return webRobotQueries.getWebRobotRun(ctx.project.id, run.id);
	}),

	parseCronFromText: webRobotProcedure
		.input(z.object({ text: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			return { cron: await naturalLanguageToCron(ctx.project.id, input.text) };
		}),
};

const syncWebRobotJob = async (robotId: string, cron: string, enabled: boolean): Promise<WebRobotWithSchedule> => {
	const trimmedCron = cron.trim();
	if (!trimmedCron) {
		const robot = await webRobotQueries.getWebRobotById(robotId);
		if (robot?.scheduledJobId) {
			await scheduledJobQueries.deleteJob(robot.scheduledJobId);
			await webRobotQueries.updateWebRobot(robot.projectId, robot.id, { scheduledJobId: null });
		}
		const cleared = await webRobotQueries.getWebRobotById(robotId);
		if (!cleared) {
			throw new Error(`Web robot not found after scheduling: ${robotId}`);
		}
		return cleared;
	}

	const runAt = nextCronTick(trimmedCron, new Date());
	if (!runAt) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid cron expression: ${trimmedCron}` });
	}
	const job = await scheduledJobQueries.upsertRecurringJob({
		name: WEB_ROBOT_JOB_NAME,
		cron: trimmedCron,
		uniqueKey: webRobotJobUniqueKey(robotId),
		payload: { webRobotId: robotId },
		runAt,
		status: enabled ? 'pending' : 'paused',
		maxAttempts: 1,
		resetRunAtOnConflict: true,
	});

	const robot = await webRobotQueries.getWebRobotById(robotId);
	if (!robot) {
		throw new Error(`Web robot not found after scheduling: ${robotId}`);
	}
	await webRobotQueries.updateWebRobot(robot.projectId, robotId, { scheduledJobId: job.id });
	const linked = await webRobotQueries.getWebRobotById(robotId);
	if (!linked) {
		throw new Error(`Web robot not found after scheduling: ${robotId}`);
	}
	return linked;
};

const requireWebRobot = async (projectId: string, id: string): Promise<WebRobotWithSchedule> => {
	const robot = await webRobotQueries.getWebRobot(projectId, id);
	if (!robot) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${id}` });
	}
	return robot;
};

const assertValidCron = (cron: string): void => {
	const trimmed = cron.trim();
	if (!trimmed) {
		return;
	}
	try {
		CronExpressionParser.parse(trimmed);
	} catch {
		throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid cron expression: ${trimmed}` });
	}
};

const isUniqueViolation = (error: unknown): boolean => {
	const candidate = error as { code?: string; message?: string };
	return candidate.code === '23505' || /unique constraint/i.test(candidate.message ?? '');
};

const slugify = (name: string): string => {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!slugSchema.safeParse(slug).success) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a lowercase slug for this web robot.' });
	}
	return slug;
};
