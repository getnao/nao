import { TRPCError } from '@trpc/server';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod/v4';

import { env } from '../env';
import { AUTOMATION_JOB_NAME, startAutomationRun } from '../handlers/automation.handler';
import type { AutomationWithSchedule } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { agentService } from '../services/agent';
import { inferAutomationTitle } from '../services/automation-title';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { nextCronTick } from '../services/scheduler.service';
import { llmProviderSchema } from '../types/llm';
import { canSendProcedure, projectProtectedProcedure } from './trpc';

function assertAutomationsEnabled() {
	if (!env.BETA_AUTOMATIONS_ENABLED) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Automations are disabled on this instance.' });
	}
}

const automationProcedure = canSendProcedure.use(async ({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const automationReadProcedure = projectProtectedProcedure.use(async ({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const integrationSchema = z
	.object({
		email: z
			.object({
				enabled: z.boolean().default(false),
				recipients: z.array(z.string().email()).default([]),
				subject: z.string().trim().max(255).optional(),
			})
			.optional(),
		slack: z
			.object({
				enabled: z.boolean().default(false),
				channelId: z.string().trim().default(''),
			})
			.optional(),
		github: z
			.object({
				enabled: z.boolean().default(false),
				repositories: z.array(z.string().trim().min(1)).default([]),
				actions: z
					.object({
						createIssue: z.boolean().default(false),
						createPullRequest: z.boolean().default(false),
						addComment: z.boolean().default(false),
					})
					.optional(),
			})
			.optional(),
	})
	.default({});

const writeAutomationSchema = z.object({
	title: z.string().trim().min(1).max(255),
	prompt: z.string().trim().min(1).max(20_000),
	cron: z.string().trim().min(1),
	scheduleDescription: z.string().trim().max(255).optional(),
	timezone: z.string().trim().max(100).optional(),
	modelProvider: llmProviderSchema.optional(),
	modelId: z.string().trim().min(1).optional(),
	enabled: z.boolean().default(true),
	mcpEnabled: z.boolean().default(true),
	mcpServers: z.array(z.string().trim().min(1)).optional(),
	integrations: integrationSchema,
});

const createAutomationSchema = writeAutomationSchema.extend({
	title: z.string().trim().max(255).optional(),
});

export const automationRoutes = {
	list: automationReadProcedure.query(async ({ ctx }) => {
		return automationQueries.listAutomations(ctx.project.id, ctx.user.id);
	}),

	feed: automationReadProcedure
		.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
		.query(async ({ ctx, input }) => {
			return automationQueries.listAutomationFeedRuns(ctx.project.id, ctx.user.id, input.limit);
		}),

	get: automationProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
		if (!automation) {
			return null;
		}
		const runs = await automationQueries.listAutomationRuns(ctx.project.id, ctx.user.id, input.id);
		return { automation, runs };
	}),

	create: automationProcedure.input(createAutomationSchema).mutation(async ({ ctx, input }) => {
		assertValidCron(input.cron);
		const { cron, enabled, title, ...promptInput } = input;
		const resolvedTitle = title?.trim() || (await inferAutomationTitle(ctx.project.id, input.prompt));
		const automation = await automationQueries.createAutomation({
			...promptInput,
			title: resolvedTitle,
			projectId: ctx.project.id,
			userId: ctx.user.id,
			scheduleDescription: input.scheduleDescription || null,
			timezone: getServerTimezone(),
			modelProvider: input.modelProvider || null,
			modelId: input.modelId || null,
			mcpServers: input.mcpServers,
		});
		return syncAutomationJob(automation, cron, enabled);
	}),

	update: automationProcedure
		.input(writeAutomationSchema.extend({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			assertValidCron(input.cron);
			const { id, cron, enabled, ...data } = input;
			const automation = await automationQueries.updateAutomation(ctx.project.id, ctx.user.id, id, {
				...data,
				scheduleDescription: data.scheduleDescription || null,
				timezone: getServerTimezone(),
				modelProvider: data.modelProvider || null,
				modelId: data.modelId || null,
				mcpServers: data.mcpServers,
			});
			if (!automation) {
				return null;
			}
			return syncAutomationJob(automation, cron, enabled);
		}),

	setEnabled: automationProcedure
		.input(z.object({ id: z.string(), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
			if (!automation) {
				return null;
			}
			return syncAutomationJob(automation, automation.cron, input.enabled);
		}),

	delete: automationProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
		if (!automation) {
			return { success: true };
		}
		if (automation.scheduledJobId) {
			await scheduledJobQueries.deleteJob(automation.scheduledJobId);
		}
		await automationQueries.deleteAutomation(ctx.project.id, ctx.user.id, input.id);
		return { success: true };
	}),

	runNow: automationProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
		if (!automation) {
			return null;
		}
		return startAutomationRun(input.id, { requireEnabled: false });
	}),

	/**
	 * Cancels an in-flight automation run. Aborts the agent stream when it's
	 * still alive on this process, and always force-flips the DB row from
	 * `running` to `cancelled` — so runs left dangling by a server restart
	 * (or any other status mismatch) can be unstuck from the UI.
	 */
	cancelRun: automationProcedure.input(z.object({ runId: z.string() })).mutation(async ({ ctx, input }) => {
		const run = await automationQueries.getAutomationRunForUser(ctx.project.id, ctx.user.id, input.runId);
		if (!run) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Automation run not found: ${input.runId}` });
		}
		if (run.status !== 'running') {
			return { ...run, alreadyTerminal: true as const };
		}

		if (run.chatId) {
			agentService.get(run.chatId)?.stop();
		}
		const updated = await automationQueries.cancelAutomationRun(input.runId);
		const fresh = await automationQueries.getAutomationRunForUser(ctx.project.id, ctx.user.id, input.runId);
		if (!fresh) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Automation run not found: ${input.runId}` });
		}
		return { ...fresh, alreadyTerminal: !updated };
	}),

	parseCronFromText: automationReadProcedure
		.input(z.object({ text: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const cron = await naturalLanguageToCron(ctx.project.id, input.text);
			return { cron };
		}),
};

async function syncAutomationJob(
	automation: Pick<AutomationWithSchedule, 'id'>,
	cron: string,
	enabled: boolean,
): Promise<AutomationWithSchedule> {
	const uniqueKey = automationQueries.automationJobUniqueKey(automation.id);
	const runAt = nextCronTick(cron, new Date());
	if (!runAt) {
		throw new Error(`Invalid cron expression: ${cron}`);
	}

	const job = await scheduledJobQueries.upsertRecurringJob({
		name: AUTOMATION_JOB_NAME,
		cron,
		uniqueKey,
		payload: { automationId: automation.id },
		runAt,
		status: enabled ? 'pending' : 'paused',
		resetRunAtOnConflict: true,
	});

	await automationQueries.linkAutomationJob(automation.id, job.id);
	const linked = await automationQueries.getAutomationById(automation.id);
	if (!linked) {
		throw new Error(`Automation not found after scheduling: ${automation.id}`);
	}
	return linked;
}

function assertValidCron(cron: string): void {
	CronExpressionParser.parse(cron);
}

function getServerTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
