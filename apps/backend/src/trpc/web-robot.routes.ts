import { webRobotBrowserActionSchema, webRobotBrowserCaptureSchema, webRobotRecipeSchema } from '@nao/shared/web-robot';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { env } from '../env';
import { requestWebRobotCancellation } from '../handlers/web-robot.handler';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import type { WebRobotWithSchedule } from '../queries/web-robot.queries';
import * as webRobotQueries from '../queries/web-robot.queries';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { isStorageEnabled, STORAGE_DISABLED_MESSAGE } from '../services/storage';
import { listProjectDatasetDirectory, readProjectDataset } from '../services/storage/project-datasets';
import {
	createWebRobot,
	enqueueWebRobotRunNow,
	slugifyWebRobotName,
	syncWebRobotSchedule,
	uniqueWebRobotSlug,
	updateWebRobot,
} from '../services/web-robot';
import { authorWebRobotRecipeFromUrl } from '../services/web-robot-authoring';
import { previewWebRobotRepair } from '../services/web-robot-authoring/repair';
import { inspectWebRobotUrl, runWebRobotRecipe } from '../services/web-scraper';
import { isAllowedHostname } from '../services/web-scraper/url-policy';
import { isDatasetPath, toDatasetRelativePath, toDatasetVirtualPath } from '../utils/tools';
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
		return createWebRobot(ctx.project.id, ctx.user.id, input);
	}),

	createFromUrl: webRobotProcedure
		.input(z.object({ url: httpUrlSchema.max(4096), name: z.string().trim().min(1).max(255).optional() }))
		.mutation(async ({ ctx, input }) => {
			const authored = await authorWebRobotRecipeFromUrl({
				projectId: ctx.project.id,
				url: input.url,
				env: await projectQueries.getEnvVars(ctx.project.id),
			});
			if (authored.status !== 'ready') {
				return authored;
			}

			const name = input.name ?? suggestedRobotName(authored.diagnostics.discovery.title, input.url);
			const robot = await createWebRobot(ctx.project.id, ctx.user.id, {
				name,
				slug: await uniqueWebRobotSlug(ctx.project.id, suggestedRobotSlug(name, input.url)),
				description: `Automatically generated from ${input.url}`,
				recipe: authored.recipe,
				cron: '',
				enabled: false,
			});
			const warnings = [...authored.warnings];
			const run = await enqueueWebRobotRunNow(ctx.project.id, ctx.user.id, robot.id).catch((error) => {
				warnings.push(
					`The source was created, but the initial run could not be queued: ${errorMessage(error)}`,
				);
				return null;
			});
			return {
				status: 'created' as const,
				robot,
				run,
				score: authored.score,
				recipe: authored.recipe,
				sampleProducts: authored.sampleProducts,
				warnings,
				diagnostics: authored.diagnostics,
			};
		}),

	importRobot: webRobotProcedure
		.input(z.object({ robot: createWebRobotSchema }))
		.mutation(async ({ ctx, input }) => createWebRobot(ctx.project.id, ctx.user.id, input.robot)),

	exportRobot: webRobotProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const robot = await requireWebRobot(ctx.project.id, input.id);
		return {
			format: 'nao-web-robot' as const,
			formatVersion: 1,
			name: robot.name,
			slug: robot.slug,
			description: robot.description ?? undefined,
			recipe: robot.definition,
			cron: robot.cron ?? '',
			enabled: robot.enabled,
		};
	}),

	update: webRobotProcedure.input(updateWebRobotSchema).mutation(async ({ ctx, input }) => {
		const { id, ...definition } = input;
		const robot = await updateWebRobot(ctx.project.id, id, definition);
		if (!robot) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${input.id}` });
		}
		return robot;
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
			return syncWebRobotSchedule(robot.id, robot.cron ?? '', input.enabled);
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
		return enqueueWebRobotRunNow(ctx.project.id, ctx.user.id, input.id);
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

	previewRepair: webRobotProcedure
		.input(z.object({ id: z.string(), runId: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			const robot = await requireWebRobot(ctx.project.id, input.id);
			const run = input.runId ? await webRobotQueries.getWebRobotRun(ctx.project.id, input.runId) : undefined;
			if (input.runId && !run) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot run not found: ${input.runId}` });
			}
			if (run && run.robotId !== robot.id) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'The selected run belongs to a different web robot.',
				});
			}
			if (run && !['failed', 'partial'].includes(run.status)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Repair previews are available for failed or partial web robot runs.',
				});
			}
			return previewWebRobotRepair({
				projectId: ctx.project.id,
				currentRecipe: robot.definition,
				runRecipe: run?.definition,
				env: await projectQueries.getEnvVars(ctx.project.id),
			});
		}),

	applyRepair: webRobotProcedure
		.input(
			z.object({
				id: z.string(),
				expectedDefinitionHash: z.string().trim().min(1).max(128),
				recipe: webRobotRecipeSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const robot = await requireWebRobot(ctx.project.id, input.id);
			if (robot.definitionHash !== input.expectedDefinitionHash) {
				throw new TRPCError({
					code: 'CONFLICT',
					message:
						'The web robot changed after the repair preview. Generate a new preview before applying it.',
				});
			}
			assertRepairRecipeScope(robot.definition, input.recipe);
			const updated = await updateWebRobot(ctx.project.id, robot.id, {
				name: robot.name,
				description: robot.description ?? undefined,
				recipe: input.recipe,
				cron: robot.cron ?? '',
				enabled: robot.enabled,
			});
			if (!updated) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${input.id}` });
			}
			return {
				robot: updated,
				previousDefinitionHash: robot.definitionHash,
				definitionHash: updated.definitionHash,
			};
		}),

	getRunArtifacts: webRobotProcedure.input(z.object({ runId: z.string() })).query(async ({ ctx, input }) => {
		const run = await webRobotQueries.getWebRobotRun(ctx.project.id, input.runId);
		if (!run) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot run not found: ${input.runId}` });
		}
		if (!run.artifactPrefix || !isDatasetPath(run.artifactPrefix)) {
			return { files: [], manifest: null, readme: null };
		}

		const relativePath = toDatasetRelativePath(run.artifactPrefix);
		const files = await listProjectDatasetDirectory(ctx.project.id, relativePath);
		const manifest = await readProjectDataset(ctx.project.id, `${relativePath}/manifest.json`)
			.then(parseJsonObject)
			.catch(() => null);
		const readme = await readProjectDataset(ctx.project.id, `${relativePath}/README.md`).catch(() => null);
		return {
			files: files.map((file) => ({
				...file,
				path: toDatasetVirtualPath(file.relativePath),
			})),
			manifest,
			readme,
		};
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

const assertRepairRecipeScope = (current: WebRobotWithSchedule['definition'], next: typeof current): void => {
	const currentHosts = new Set(current.allowedHosts.map((host) => host.toLowerCase()));
	for (const host of next.allowedHosts) {
		if (!currentHosts.has(host.toLowerCase())) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Repair recipes cannot add allowed host '${host}'.`,
			});
		}
	}
	for (const stage of next.stages) {
		if (stage.source.url.includes('{{')) {
			continue;
		}
		const hostname = new URL(stage.source.url).hostname;
		if (!isAllowedHostname(hostname, next.allowedHosts)) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Stage '${stage.id}' uses a source outside the recipe's allowed hosts.`,
			});
		}
	}
};

const requireWebRobot = async (projectId: string, id: string): Promise<WebRobotWithSchedule> => {
	const robot = await webRobotQueries.getWebRobot(projectId, id);
	if (!robot) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Web robot not found: ${id}` });
	}
	return robot;
};

const parseJsonObject = (value: string): Record<string, unknown> => {
	const parsed = JSON.parse(value) as unknown;
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: {};
};

const suggestedRobotName = (title: string | undefined, url: string): string => {
	const base = (title || new URL(url).hostname).slice(0, 80).trim();
	return /\b(products?|catalogue|catalog)\b/i.test(base) ? base : `${base} products`;
};

const suggestedRobotSlug = (name: string, url: string): string => {
	try {
		return slugifyWebRobotName(name);
	} catch {
		const parsed = new URL(url);
		return `${parsed.hostname}${parsed.pathname}`;
	}
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
