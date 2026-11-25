import type { AutomationEventTriggers, LlmProvider, UserRole } from '@nao/shared/types';
import { CronExpressionParser } from 'cron-parser';

import { env } from '../env';
import { AUTOMATION_JOB_NAME } from '../handlers/automation.handler';
import type { AutomationWithAccess, AutomationWithSchedule } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as chatQueries from '../queries/chat.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import type { AutomationIntegrationConfig } from '../types/automation';
import { HandlerError } from '../utils/error';
import { canRoleReceiveChatFeedback } from './automation-feedback-trigger.service';
import { inferAutomationTitle } from './automation-title';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';
import { nextCronTick } from './scheduler.service';
import { assertUserGroupFeature } from './user-group-feature-access.service';

/** Who manages automations, from the app or from the MCP: both go through the same checks. */
export interface AutomationActor {
	userId: string;
	projectId: string;
	role: UserRole | null;
}

export interface AutomationSettings {
	title: string;
	prompt: string;
	/** An empty cron means the automation has no schedule trigger. */
	cron: string;
	scheduleDescription?: string;
	modelProvider?: LlmProvider;
	modelId?: string;
	llmConfigId?: string;
	enabled: boolean;
	mcpEnabled: boolean;
	mcpServers?: string[];
	integrations: AutomationIntegrationConfig;
	webhookEnabled: boolean;
	eventTriggers: AutomationEventTriggers;
}

export type NewAutomationSettings = Omit<AutomationSettings, 'title'> & {
	/** Inferred from the prompt when empty. */
	title?: string;
	/** The chat the automation was drafted in, which then follows the automation. */
	editorChatId?: string;
};

export function assertAutomationsEnabled(): void {
	if (!env.BETA_AUTOMATIONS_ENABLED) {
		throw new HandlerError('FORBIDDEN', 'Automations are disabled on this instance.');
	}
}

/** The automations the user owns or that are shared with them. */
export async function listAutomations(actor: AutomationActor) {
	assertAutomationsEnabled();
	return automationQueries.listAutomations(actor.projectId, actor.userId);
}

/** Null when the automation does not exist or is not shared with the user. */
export async function getAutomation(actor: AutomationActor, id: string): Promise<AutomationWithAccess | null> {
	assertAutomationsEnabled();
	return automationQueries.getAutomation(actor.projectId, actor.userId, id, 'viewer');
}

export async function getAutomationWithRuns(actor: AutomationActor, id: string) {
	const automation = await getAutomation(actor, id);
	if (!automation) {
		return null;
	}
	const runs = await automationQueries.listAutomationRuns(actor.projectId, id);
	return { automation, runs };
}

export async function createAutomation(
	actor: AutomationActor,
	settings: NewAutomationSettings,
): Promise<AutomationWithSchedule> {
	await assertCanManageAutomations(actor, { billing: true });
	await assertUserGroupFeature(actor.projectId, actor.userId, 'automationCreation');
	assertTriggers(settings, actor.role);
	const { cron, enabled, title, editorChatId, ...fields } = settings;
	const resolvedTitle =
		title?.trim() ||
		(await inferAutomationTitle(actor.projectId, actor.userId, settings.prompt, getModelSelection(settings)));
	const automation = await automationQueries.createAutomation({
		...toAutomationColumns(fields),
		title: resolvedTitle,
		projectId: actor.projectId,
		userId: actor.userId,
	});
	if (editorChatId) {
		await chatQueries.linkAutomationEditChat(editorChatId, actor.userId, automation);
	}
	return syncAutomationJob(automation, cron, enabled);
}

/** Null when the automation does not exist or the user may not edit it. */
export async function updateAutomation(
	actor: AutomationActor,
	id: string,
	settings: AutomationSettings,
): Promise<AutomationWithSchedule | null> {
	await assertCanManageAutomations(actor, { billing: settings.enabled });
	assertTriggers(settings, actor.role);
	if (!(await automationQueries.getAutomation(actor.projectId, actor.userId, id, 'editor'))) {
		return null;
	}
	const { cron, enabled, ...fields } = settings;
	const automation = await automationQueries.updateAutomation(actor.projectId, id, {
		...toAutomationColumns(fields),
		title: fields.title,
	});
	if (!automation) {
		return null;
	}
	return syncAutomationJob(automation, cron, enabled);
}

/** Only enabling an automation needs billing access; disabling one does not. */
export async function setAutomationEnabled(
	actor: AutomationActor,
	id: string,
	enabled: boolean,
): Promise<AutomationWithSchedule | null> {
	await assertCanManageAutomations(actor, { billing: enabled });
	const automation = await automationQueries.getAutomation(actor.projectId, actor.userId, id, 'editor');
	if (!automation) {
		return null;
	}
	return syncAutomationJob(automation, automation.cron, enabled);
}

/** Only the owner deletes an automation: false when there was nothing the user could delete. */
export async function deleteAutomation(actor: AutomationActor, id: string): Promise<boolean> {
	await assertCanManageAutomations(actor, { billing: false });
	const automation = await automationQueries.getAutomation(actor.projectId, actor.userId, id, 'owner');
	if (!automation) {
		return false;
	}
	if (automation.scheduledJobId) {
		await scheduledJobQueries.deleteJob(automation.scheduledJobId);
	}
	await automationQueries.deleteAutomation(actor.projectId, actor.userId, id);
	return true;
}

export function toAutomationSettings(automation: AutomationWithSchedule): AutomationSettings {
	return {
		title: automation.title,
		prompt: automation.prompt,
		cron: automation.cron,
		scheduleDescription: automation.scheduleDescription ?? undefined,
		modelProvider: automation.modelProvider ?? undefined,
		modelId: automation.modelId ?? undefined,
		llmConfigId: automation.llmConfigId ?? undefined,
		enabled: automation.enabled,
		mcpEnabled: automation.mcpEnabled,
		mcpServers: automation.mcpServers ?? undefined,
		integrations: automation.integrations,
		webhookEnabled: automation.webhookEnabled,
		eventTriggers: automation.eventTriggers,
	};
}

/**
 * Reconciles an automation's schedule trigger with its linked scheduled job.
 * An empty cron means the automation has no schedule trigger (e.g. it only
 * runs via webhook), so any existing job is removed and the link cleared.
 */
export async function syncAutomationJob(
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

/** Viewers only read the automations shared with them. */
async function assertCanManageAutomations(actor: AutomationActor, { billing }: { billing: boolean }): Promise<void> {
	assertAutomationsEnabled();
	if (actor.role !== 'admin' && actor.role !== 'user' && actor.role !== 'context_admin') {
		throw new HandlerError('FORBIDDEN', 'Viewers cannot perform this action');
	}
	if (billing) {
		await assertProjectCloudBillingAccess(actor.projectId);
	}
}

function assertTriggers(
	{ cron, webhookEnabled, eventTriggers }: Pick<AutomationSettings, 'cron' | 'webhookEnabled' | 'eventTriggers'>,
	role: UserRole | null,
): void {
	if (!cron.trim() && !webhookEnabled && !hasEnabledEventTrigger(eventTriggers)) {
		throw new HandlerError('BAD_REQUEST', 'Add at least one trigger.');
	}
	if (cron.trim()) {
		assertValidCron(cron.trim());
	}
	if (eventTriggers.feedback?.sources.includes('chat') && !canRoleReceiveChatFeedback(role)) {
		throw new HandlerError('FORBIDDEN', 'Only admins and context admins can trigger automations on chat feedback.');
	}
}

function hasEnabledEventTrigger(eventTriggers: AutomationEventTriggers): boolean {
	return Object.values(eventTriggers).some((trigger) => trigger?.enabled);
}

function toAutomationColumns(fields: Omit<AutomationSettings, 'cron' | 'enabled' | 'title'>) {
	return {
		prompt: fields.prompt,
		scheduleDescription: fields.scheduleDescription || null,
		timezone: getServerTimezone(),
		modelProvider: fields.modelProvider || null,
		modelId: fields.modelId || null,
		llmConfigId: fields.llmConfigId || null,
		mcpEnabled: fields.mcpEnabled,
		mcpServers: fields.mcpServers,
		integrations: fields.integrations,
		webhookEnabled: fields.webhookEnabled,
		eventTriggers: fields.eventTriggers,
	};
}

function getModelSelection({ modelProvider, modelId, llmConfigId }: NewAutomationSettings) {
	if (!modelProvider || !modelId) {
		return undefined;
	}
	return { provider: modelProvider, modelId, ...(llmConfigId && { llmConfigId }) };
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

function assertValidCron(cron: string): void {
	CronExpressionParser.parse(cron);
}

function getServerTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
