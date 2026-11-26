import { getSlackChannelsSaveError, parseSlackChannels } from '@nao/shared/slack-channels';
import { FEEDBACK_SOURCES, FEEDBACK_VOTES, SHARE_ROLES, SHARE_VISIBILITY, type UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { startAutomationRun } from '../handlers/automation.handler';
import type {
	AutomationWithAccess,
	AutomationWithSchedule,
	ProjectAutomationSummary,
} from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { agentService } from '../services/agent';
import {
	assertAutomationsEnabled,
	type AutomationActor,
	createAutomation,
	deleteAutomation,
	getAutomationWithRuns,
	listAutomations,
	setAutomationActive,
	setAutomationEnabled,
	updateAutomation,
} from '../services/automation.service';
import { startAutomationEditChat } from '../services/automation-editor.service';
import { getAutomationShareSettings, saveAutomationShareSettings } from '../services/automation-share.service';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { listShareableMembers } from '../services/project-sharing.service';
import { hasTableAccessOf, MISSING_TABLE_ACCESS_MESSAGE } from '../services/user-group-context-access.service';
import { llmProviderSchema } from '../types/llm';
import {
	adminProtectedProcedure,
	canSendProcedure,
	cloudBillingCanSendProcedure,
	cloudBillingMiddleware,
	cloudBillingProjectProcedure,
	projectProtectedProcedure,
} from './trpc';

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

export const automationAdminProcedure = adminProtectedProcedure.use(({ next }) => {
	assertAutomationsEnabled();
	return next();
});

const setAutomationEnabledSchema = z.object({ id: z.string(), enabled: z.boolean() });

/** Only enabling an automation needs billing access; editing or disabling one does not. */
const enablingAutomationBillingMiddleware = cloudBillingMiddleware<
	{ project: { id: string; orgId: string | null } },
	{ enabled?: boolean }
>(({ project }, input) => ((input.enabled ?? true) ? { projectId: project.id, organizationId: project.orgId } : null));

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

const eventTriggersSchema = z
	.object({
		feedback: z
			.object({
				enabled: z.boolean().default(true),
				votes: z.array(z.enum(FEEDBACK_VOTES)).min(1, 'Pick at least one vote.'),
				sources: z.array(z.enum(FEEDBACK_SOURCES)).min(1, 'Pick at least one source.'),
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
	llmConfigId: z.string().trim().min(1).optional(),
	enabled: z.boolean().default(true),
	mcpEnabled: z.boolean().default(true),
	mcpServers: z.array(z.string().trim().min(1)).optional(),
	integrations: integrationSchema,
	webhookEnabled: z.boolean().default(false),
	eventTriggers: eventTriggersSchema,
});

const shareGrantSchema = z.object({ id: z.string(), role: z.enum(SHARE_ROLES) });

const saveShareSettingsSchema = z.object({
	id: z.string(),
	visibility: z.enum(SHARE_VISIBILITY),
	projectRole: z.enum(SHARE_ROLES).default('viewer'),
	users: z.array(shareGrantSchema).default([]),
	groups: z.array(shareGrantSchema).default([]),
});

const createAutomationSchema = writeAutomationSchema.extend({
	title: z.string().trim().max(255).optional(),
	/** The chat the automation was drafted in, which then follows the automation. */
	editorChatId: z.string().optional(),
});

export const automationRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		return listAutomations(toAutomationActor(ctx));
	}),

	feed: automationReadProcedure
		.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
		.query(async ({ ctx, input }) => {
			return automationQueries.listAutomationFeedRuns(ctx.project.id, ctx.user.id, input.limit);
		}),

	get: projectProtectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		return getAutomationWithRuns(toAutomationActor(ctx), input.id);
	}),

	create: projectProtectedProcedure.input(createAutomationSchema).mutation(async ({ ctx, input }) => {
		return createAutomation(toAutomationActor(ctx), input);
	}),

	startEditChat: automationProcedure
		.input(z.object({ automationId: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			return startAutomationEditChat({
				userId: ctx.user.id,
				projectId: ctx.project.id,
				automationId: input.automationId,
			});
		}),

	latestEditChat: automationProcedure
		.input(z.object({ automationId: z.string() }))
		.query(async ({ ctx, input }): Promise<{ chatId: string | null }> => {
			return { chatId: await chatQueries.getLatestAutomationEditChatId(ctx.user.id, input.automationId) };
		}),

	update: projectProtectedProcedure
		.input(writeAutomationSchema.extend({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { id, ...settings } = input;
			return updateAutomation(toAutomationActor(ctx), id, settings);
		}),

	setEnabled: projectProtectedProcedure.input(setAutomationEnabledSchema).mutation(async ({ ctx, input }) => {
		return setAutomationEnabled(toAutomationActor(ctx), input.id, input.enabled);
	}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		await deleteAutomation(toAutomationActor(ctx), input.id);
		return { success: true };
	}),

	runNow: automationMutationProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, input.id, 'editor');
		if (!automation) {
			return null;
		}
		return startAutomationRun(input.id, {
			billingAccessVerifiedProjectId: ctx.project.id,
			requireEnabled: false,
			trigger: 'manual',
		});
	}),

	/**
	 * Cancels an in-flight automation run. Aborts the agent stream when it's
	 * still alive on this process, and always force-flips the DB row from
	 * `running` to `cancelled` — so runs left dangling by a server restart
	 * (or any other status mismatch) can be unstuck from the UI.
	 */
	cancelRun: automationProcedure.input(z.object({ runId: z.string() })).mutation(async ({ ctx, input }) => {
		const run = await getEditableRun(ctx.project.id, ctx.user.id, input.runId);
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
		const fresh = await automationQueries.getProjectAutomationRun(ctx.project.id, input.runId);
		if (!fresh) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Automation run not found: ${input.runId}` });
		}
		return { ...fresh, alreadyTerminal: !updated };
	}),

	unreadCount: automationReadProcedure.query(async ({ ctx }): Promise<number> => {
		return automationQueries.countUnreadAutomationRuns(ctx.project.id, ctx.user.id);
	}),

	markRunRead: automationReadProcedure
		.input(z.object({ runId: z.string(), read: z.boolean().default(true) }))
		.mutation(async ({ ctx, input }) => {
			const marked = await automationQueries.markAutomationRunRead(
				ctx.project.id,
				ctx.user.id,
				input.runId,
				input.read,
			);
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

	getShareSettings: automationReadProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const automation = await getAutomationToShare(ctx, input.id);
		return getAutomationShareSettings(automation, toShareActor(ctx));
	}),

	saveShareSettings: automationProcedure.input(saveShareSettingsSchema).mutation(async ({ ctx, input }) => {
		const { id, ...change } = input;
		const automation = await getAutomationToShare(ctx, id);
		await saveAutomationShareSettings(automation, toShareActor(ctx), change);
		return { success: true as const };
	}),

	listShareCandidates: automationProcedure.query(async ({ ctx }) => {
		return listShareableMembers(ctx.project.id, ctx.user.id);
	}),

	listEmailRecipients: automationProcedure.query(async ({ ctx }) => {
		const members = await listShareableMembers(ctx.project.id, ctx.user.id);
		return members.map((member) => ({ email: member.email, name: member.name }));
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
			await assertCanOwnAutomation(ctx.project.id, input.newOwnerId, automation.userId);
			await automationQueries.transferAutomationOwnership(automation.id, input.newOwnerId);
			return { success: true as const };
		}),

	countOwnedByUser: automationAdminProcedure.input(z.object({ userId: z.string() })).query(async ({ ctx, input }) => {
		const count = await automationQueries.countProjectAutomationsOfUser(ctx.project.id, input.userId);
		return { count };
	}),

	transferAllFromUser: automationAdminProcedure
		.input(z.object({ fromUserId: z.string(), recipientId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			if (input.fromUserId === input.recipientId) {
				return { transferredCount: 0 };
			}
			await assertCanOwnAutomation(ctx.project.id, input.recipientId, input.fromUserId);
			const transferredCount = await automationQueries.transferProjectAutomationsOfUser(
				ctx.project.id,
				input.fromUserId,
				input.recipientId,
			);
			return { transferredCount };
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

type AutomationRequestContext = {
	user: { id: string; name: string };
	userRole: UserRole | null;
	project: { id: string };
};

/** Admins manage the sharing of every automation of the project; others need to see it. */
async function getAutomationToShare(ctx: AutomationRequestContext, id: string): Promise<AutomationWithAccess> {
	const automation = await automationQueries.getAutomation(ctx.project.id, ctx.user.id, id, 'viewer');
	if (automation) {
		return automation;
	}
	const projectAutomation =
		ctx.userRole === 'admin' && (await automationQueries.getProjectAutomation(ctx.project.id, id));
	if (!projectAutomation) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Automation not found: ${id}` });
	}
	return { ...projectAutomation, accessRole: 'viewer' };
}

function toAutomationActor(ctx: AutomationRequestContext): AutomationActor {
	return { userId: ctx.user.id, projectId: ctx.project.id, role: ctx.userRole };
}

function toShareActor(ctx: AutomationRequestContext) {
	return { id: ctx.user.id, name: ctx.user.name, role: ctx.userRole, projectId: ctx.project.id };
}

/** A run can be cancelled by whoever may edit its automation. */
async function getEditableRun(projectId: string, userId: string, runId: string) {
	const run = await automationQueries.getProjectAutomationRun(projectId, runId);
	const automation = run && (await automationQueries.getAutomation(projectId, userId, run.automationId, 'editor'));
	return automation ? run : null;
}

async function getProjectAutomationOrThrow(projectId: string, id: string): Promise<AutomationWithSchedule> {
	const automation = await automationQueries.getProjectAutomation(projectId, id);
	if (!automation) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Automation not found: ${id}` });
	}
	return automation;
}

async function assertCanOwnAutomation(projectId: string, userId: string, previousOwnerId: string): Promise<void> {
	const role = await projectQueries.getUserRoleInProject(projectId, userId);
	if (!role) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The new owner must have access to this project.' });
	}
	if (role === 'viewer') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Viewers cannot own automations.' });
	}
	if (!(await hasTableAccessOf(projectId, previousOwnerId, userId))) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: MISSING_TABLE_ACCESS_MESSAGE });
	}
}
