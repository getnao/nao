import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod/v4';

import { AUTOMATION_JOB_NAME, startAutomationRun } from '../handlers/automation.handler';
import type { AutomationWithSchedule } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { nextCronTick } from '../services/scheduler.service';
import { llmProviderSchema } from '../types/llm';
import { canSendProcedure, projectProtectedProcedure } from './trpc';

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

export const automationRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		return automationQueries.listAutomations(ctx.project.id, ctx.user.id);
	}),

	get: canSendProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
		if (!automation) {
			return null;
		}
		const runs = await automationQueries.listAutomationRuns(ctx.project.id, ctx.user.id, input.id);
		return { automation, runs };
	}),

	create: canSendProcedure.input(writeAutomationSchema).mutation(async ({ ctx, input }) => {
		assertValidCron(input.cron);
		const { cron, enabled, ...promptInput } = input;
		const automation = await automationQueries.createAutomation({
			...promptInput,
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

	update: canSendProcedure
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

	setEnabled: canSendProcedure
		.input(z.object({ id: z.string(), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
			if (!automation) {
				return null;
			}
			return syncAutomationJob(automation, automation.cron, input.enabled);
		}),

	delete: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
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

	runNow: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
		if (!automation) {
			return null;
		}
		return startAutomationRun(input.id, { requireEnabled: false });
	}),

	parseCronFromText: projectProtectedProcedure
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
