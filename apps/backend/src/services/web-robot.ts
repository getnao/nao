import { emptyWebRobotRunStats, type WebRobotRecipe, webRobotRecipeSchema } from '@nao/shared/web-robot';
import { TRPCError } from '@trpc/server';
import { CronExpressionParser } from 'cron-parser';

import type { DBWebRobotRun } from '../db/abstractSchema';
import { WEB_ROBOT_JOB_NAME, webRobotJobUniqueKey } from '../handlers/web-robot.handler';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import type { WebRobotWithSchedule } from '../queries/web-robot.queries';
import * as webRobotQueries from '../queries/web-robot.queries';
import { nextCronTick } from './scheduler.service';
import { webRobotDefinitionHash } from './web-scraper/definition';

export type CreateWebRobotInput = {
	name: string;
	slug?: string;
	description?: string;
	recipe: WebRobotRecipe;
	cron?: string;
	enabled?: boolean;
};

export const createWebRobot = async (
	projectId: string,
	userId: string,
	input: CreateWebRobotInput,
): Promise<WebRobotWithSchedule> => {
	const cron = input.cron ?? '';
	assertValidCron(cron);
	const slug = input.slug ?? slugifyWebRobotName(input.name);
	const recipe = webRobotRecipeSchema.parse(input.recipe);
	const robot = await webRobotQueries
		.createWebRobot({
			projectId,
			userId,
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
	return syncWebRobotSchedule(robot.id, cron, input.enabled ?? true);
};

export const updateWebRobot = async (
	projectId: string,
	id: string,
	input: CreateWebRobotInput,
): Promise<WebRobotWithSchedule | null> => {
	const cron = input.cron ?? '';
	assertValidCron(cron);
	const recipe = webRobotRecipeSchema.parse(input.recipe);
	const robot = await webRobotQueries.updateWebRobot(projectId, id, {
		name: input.name,
		description: input.description || null,
		definition: recipe,
		definitionVersion: recipe.version,
		definitionHash: webRobotDefinitionHash(recipe),
	});
	return robot ? syncWebRobotSchedule(robot.id, cron, input.enabled ?? true) : null;
};

export const enqueueWebRobotRunNow = async (
	projectId: string,
	userId: string,
	robotId: string,
): Promise<DBWebRobotRun> => {
	const robot = await webRobotQueries.getWebRobot(projectId, robotId);
	if (!robot) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${robotId}` });
	}
	const activeRun = await webRobotQueries.findActiveWebRobotRun(robot.id);
	if (activeRun) {
		throw new TRPCError({ code: 'CONFLICT', message: 'This web robot already has an active run.' });
	}

	const run = await webRobotQueries.createWebRobotRun({
		robotId: robot.id,
		triggeredByUserId: userId,
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
	const queued = await webRobotQueries.getWebRobotRun(projectId, run.id);
	if (!queued) {
		throw new Error(`Web robot run not found after enqueueing: ${run.id}`);
	}
	return queued;
};

export const syncWebRobotSchedule = async (
	robotId: string,
	cron: string,
	enabled: boolean,
): Promise<WebRobotWithSchedule> => {
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

export const uniqueWebRobotSlug = async (projectId: string, preferredName: string): Promise<string> => {
	const base = slugifyWebRobotName(preferredName);
	const existing = new Set((await webRobotQueries.listWebRobots(projectId)).map((robot) => robot.slug));
	if (!existing.has(base)) {
		return base;
	}
	for (let index = 2; index < 100; index += 1) {
		const candidate = `${base}-${index}`;
		if (!existing.has(candidate)) {
			return candidate;
		}
	}
	throw new TRPCError({ code: 'CONFLICT', message: `Could not generate a unique web robot slug for '${base}'.` });
};

export const slugifyWebRobotName = (name: string): string => {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a lowercase slug for this web robot.' });
	}
	return slug;
};

const assertValidCron = (cron: string): void => {
	const trimmedCron = cron.trim();
	if (!trimmedCron) {
		return;
	}
	try {
		CronExpressionParser.parse(trimmedCron);
	} catch {
		throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid cron expression: ${trimmedCron}` });
	}
};

const isUniqueViolation = (error: unknown): boolean => {
	const candidate = error as { code?: string; message?: string };
	return candidate.code === '23505' || /unique constraint/i.test(candidate.message ?? '');
};
