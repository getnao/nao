import { getSlackChannelsSaveError, parseSlackChannels } from '@nao/shared/slack-channels';
import { TRPCError } from '@trpc/server';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod/v4';

import { env } from '../env';
import { AUTOMATION_JOB_NAME, startAutomationRun } from '../handlers/automation.handler';
import type { AutomationWithSchedule, ProjectAutomationSummary } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { agentService } from '../services/agent';
import { inferAutomationTitle } from '../services/automation-title';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { nextCronTick } from '../services/scheduler.service';
import { llmProviderSchema } from '../types/llm';
import {
	adminProtectedProcedure,
	canSendProcedure,
	cloudBillingCanSendProcedure,
	cloudBillingMiddleware,
	cloudBillingProjectProcedure,
	projectProtectedProcedure,
} from './trpc';
import { assertUserGroupFeatureForTrpc } from './user-group-feature-access';

function assertAutomationsEnabled() {
	if (!env.BETA_AUTOMATIONS_ENABLED) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Automations are disabled on this instance.' });
	}
}

const automationProcedure = canSendProcedure.use(({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const automationMutationProcedure = cloudBillingCanSendProcedure.use(({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const automationReadProcedure = projectProtectedProcedure.use(({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const automationCostProcedure = cloudBillingProjectProcedure.use(({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const automationAdminProcedure = adminProtectedProcedure.use(({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const setAutomationEnabledSchema = z.object({ id: z.string(), enabled: z.boolean() });

/** Only enabling an automation needs billing access; editing or disabling one does not. */
const enablingAutomationBillingMiddleware = cloudBillingMiddleware<
	{ project: { id: string; orgId: string | null } },
	{ enabled?: boolean }
>(({ project }, input) => ((input.enabled ?? true) ? { projectId: project.id, organizationId: project.orgId } : null));

const automationToggleProcedure = automationProcedure
	.input(setAutomationEnabledSchema)
	.use(enablingAutomationBillingMiddleware);

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
			.superRefine((slack, context) => {
				const error = slack.enabled ? getSlackChannelsSaveError(parseSlackChannels(slack.channelId)) : null;
				if (error) {
					context.addIssue({ code: 'custom', path: ['channelId'], message: error });
				}
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
	prompt: z.string().trim().min(1).max(40_000),
	cron: z.string().trim().default(''),
	scheduleDescription: z.string().trim().max(255).optional(),
	timezone: z.string().trim().max(100).optional(),
	modelProvider: llmProviderSchema.optional(),
	modelId: z.string().trim().min(1).optional(),
	enabled: z.boolean().default(true),
	mcpEnabled: z.boolean().default(true),
	mcpServers: z.array(z.string().trim().min(1)).optional(),
	integrations: integrationSchema,
	webhookEnabled: z.boolean().default(false),
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

	create: automationMutationProcedure.input(createAutomationSchema).mutation(async ({ ctx, input }) => {
		await assertUserGroupFeatureForTrpc(ctx.project.id, ctx.user.id, 'automationCreation');
		assertTriggers(input.cron, input.webhookEnabled);
		const { cron, enabled, title, ...promptInput } = input;
		const modelSelection =
			input.modelProvider && input.modelId
				? { provider: input.modelProvider, modelId: input.modelId }
				: undefined;
		const resolvedTitle =
			title?.trim() || (await inferAutomationTitle(ctx.project.id, ctx.user.id, input.prompt, modelSelection));
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
		.use(enablingAutomationBillingMiddleware)
		.mutation(async ({ ctx, input }) => {
			assertTriggers(input.cron, input.webhookEnabled);
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

	setEnabled: automationToggleProcedure.mutation(async ({ ctx, input }) => {
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

	runNow: automationMutationProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id);
		if (!automation) {
			return null;
		}
		return startAutomationRun(input.id, {
			billingAccessVerifiedProjectId: ctx.project.id,
			requireEnabled: false,
		});
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

	unreadCount: automationReadProcedure.query(async ({ ctx }): Promise<number> => {
		return automationQueries.countUnreadAutomationRuns(ctx.project.id, ctx.user.id);
	}),

	markRunRead: automationReadProcedure.input(z.object({ runId: z.string() })).mutation(async ({ ctx, input }) => {
		const marked = await automationQueries.markAutomationRunRead(ctx.project.id, ctx.user.id, input.runId);
		if (!marked) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Automation run not found: ${input.runId}` });
		}
		return { success: true as const };
	}),

	markAllRunsRead: automationReadProcedure.mutation(async ({ ctx }) => {
		await automationQueries.markAllAutomationRunsRead(ctx.project.id, ctx.user.id);
		return { success: true as const };
	}),

	parseCronFromText: automationCostProcedure
		.input(z.object({ text: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const cron = await naturalLanguageToCron(ctx.project.id, ctx.user.id, input.text);
			return { cron };
		}),

	listAllForAdmin: automationAdminProcedure.query(async ({ ctx }) => {
		return listProjectAutomationsWithOwnerAccess(ctx.project.id);
	}),

	setEnabledAsAdmin: automationAdminProcedure
		.input(setAutomationEnabledSchema)
		.use(enablingAutomationBillingMiddleware)
		.mutation(async ({ ctx, input }) => {
			const automation = await getProjectAutomationOrThrow(ctx.project.id, input.id);
			return setAutomationActive(automation, input.enabled);
		}),

	transferOwnership: automationAdminProcedure
		.input(z.object({ id: z.string(), newOwnerId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const automation = await getProjectAutomationOrThrow(ctx.project.id, input.id);
			if (automation.userId === input.newOwnerId) {
				return { success: true as const };
			}
			await assertCanOwnAutomation(ctx.project.id, input.newOwnerId);
			await automationQueries.transferAutomationOwnership(automation.id, input.newOwnerId);
			return { success: true as const };
		}),

	deleteAsAdmin: automationAdminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const automation = await automationQueries.getProjectAutomation(ctx.project.id, input.id);
		if (!automation) {
			return { success: true as const };
		}
		if (automation.scheduledJobId) {
			await scheduledJobQueries.deleteJob(automation.scheduledJobId);
		}
		await automationQueries.deleteProjectAutomation(ctx.project.id, input.id);
		return { success: true as const };
	}),
};

async function listProjectAutomationsWithOwnerAccess(
	projectId: string,
): Promise<Array<ProjectAutomationSummary & { ownerHasProjectAccess: boolean }>> {
	const [automations, usersWithAccess] = await Promise.all([
		automationQueries.listProjectAutomations(projectId),
		projectQueries.listUsersWithProjectAccess(projectId),
	]);
	const userIdsWithAccess = new Set(usersWithAccess.map((user) => user.id));
	return automations.map((automation) => ({
		...automation,
		ownerHasProjectAccess: automation.owner !== null && userIdsWithAccess.has(automation.owner.id),
	}));
}

async function getProjectAutomationOrThrow(projectId: string, id: string): Promise<AutomationWithSchedule> {
	const automation = await automationQueries.getProjectAutomation(projectId, id);
	if (!automation) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Automation not found: ${id}` });
	}
	return automation;
}

/**
 * Scheduled automations are paused through their job, which also blocks the webhook.
 * Webhook-only automations have no job, so their webhook trigger is the on/off switch.
 */
async function setAutomationActive(
	automation: AutomationWithSchedule,
	active: boolean,
): Promise<AutomationWithSchedule> {
	if (automation.cron) {
		return syncAutomationJob(automation, automation.cron, active);
	}
	await automationQueries.setAutomationWebhookEnabled(automation.id, active);
	return { ...automation, webhookEnabled: active };
}

async function assertCanOwnAutomation(projectId: string, userId: string): Promise<void> {
	const role = await projectQueries.getUserRoleInProject(projectId, userId);
	if (!role) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The new owner must have access to this project.' });
	}
	if (role === 'viewer') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Viewers cannot own automations.' });
	}
}

/**
 * Reconciles an automation's schedule trigger with its linked scheduled job.
 * An empty cron means the automation has no schedule trigger (e.g. it only
 * runs via webhook), so any existing job is removed and the link cleared.
 */
async function syncAutomationJob(
	automation: Pick<AutomationWithSchedule, 'id'>,
	cron: string,
	enabled: boolean,
): Promise<AutomationWithSchedule> {
	const trimmedCron = cron.trim();
	if (!trimmedCron) {
		return removeAutomationSchedule(automation.id);
	}

	assertValidCron(trimmedCron);
	const uniqueKey = automationQueries.automationJobUniqueKey(automation.id);
	const runAt = nextCronTick(trimmedCron, new Date());
	if (!runAt) {
		throw new Error(`Invalid cron expression: ${trimmedCron}`);
	}

	const job = await scheduledJobQueries.upsertRecurringJob({
		name: AUTOMATION_JOB_NAME,
		cron: trimmedCron,
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

async function removeAutomationSchedule(automationId: string): Promise<AutomationWithSchedule> {
	const current = await automationQueries.getAutomationById(automationId);
	if (current?.scheduledJobId) {
		await scheduledJobQueries.deleteJob(current.scheduledJobId);
		await automationQueries.linkAutomationJob(automationId, null);
	}
	const cleared = await automationQueries.getAutomationById(automationId);
	if (!cleared) {
		throw new Error(`Automation not found after scheduling: ${automationId}`);
	}
	return cleared;
}

function assertTriggers(cron: string, webhookEnabled: boolean): void {
	if (!cron.trim() && !webhookEnabled) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one trigger.' });
	}
	if (cron.trim()) {
		assertValidCron(cron.trim());
	}
}

function assertValidCron(cron: string): void {
	CronExpressionParser.parse(cron);
}

function getServerTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
