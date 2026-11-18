import { z } from 'zod/v4';

import { type AutomationEventTriggers, FEEDBACK_SOURCES, FEEDBACK_VOTES } from './types';

/** The automation as it stands in the editor, saved or not, which the editing chat reads and changes. */
export const automationDraftSchema = z.object({
	title: z.string().max(255),
	prompt: z.string().max(40_000),
	cron: z.string().max(255),
	scheduleDescription: z.string().max(255).optional(),
	webhookEnabled: z.boolean(),
	eventTriggers: z
		.object({
			feedback: z
				.object({
					enabled: z.boolean(),
					votes: z.array(z.enum(FEEDBACK_VOTES)).min(1),
					sources: z.array(z.enum(FEEDBACK_SOURCES)).min(1),
				})
				.optional(),
		})
		.default({}),
	modelProvider: z.string().max(100).optional(),
	modelId: z.string().max(255).optional(),
	mcpEnabled: z.boolean(),
	mcpServers: z.array(z.string().max(255)).max(100).optional(),
	integrations: z.object({
		email: z
			.object({
				enabled: z.boolean(),
				recipients: z.array(z.string().max(320)).max(100),
				subject: z.string().max(255).optional(),
			})
			.optional(),
		slack: z
			.object({
				enabled: z.boolean(),
				channelId: z.string().max(2_000),
			})
			.optional(),
		github: z
			.object({
				enabled: z.boolean(),
				repositories: z.array(z.string().max(255)).max(100),
				actions: z
					.object({
						createIssue: z.boolean().optional(),
						createPullRequest: z.boolean().optional(),
						addComment: z.boolean().optional(),
					})
					.optional(),
			})
			.optional(),
	}),
});

export type AutomationDraft = z.infer<typeof automationDraftSchema>;

/** The fields the editing chat may change; delivery integrations are replaced as a whole. */
export type AutomationDraftUpdate = Partial<
	Pick<AutomationDraft, 'title' | 'prompt' | 'cron' | 'scheduleDescription' | 'webhookEnabled'>
> & {
	integrations?: Pick<AutomationDraft['integrations'], 'email' | 'slack'>;
	/** Replaces every nao event trigger at once; an event left out is removed. */
	eventTriggers?: AutomationEventTriggers;
};

export type AutomationDraftField = 'title' | 'prompt' | 'schedule' | 'webhook' | 'feedback' | 'email' | 'slack';

/** What the editing chat's `update_automation` tool returns, which the editor applies to its form. */
export interface AutomationDraftUpdateResult {
	changedFields: AutomationDraftField[];
	update: AutomationDraftUpdate;
}

export const UPDATE_AUTOMATION_TOOL_NAME = 'update_automation';

export function applyAutomationDraftUpdate<TDraft extends AutomationDraft>(
	draft: TDraft,
	update: AutomationDraftUpdate,
): TDraft {
	const { integrations, ...fields } = update;
	return {
		...draft,
		...fields,
		integrations: { ...draft.integrations, ...integrations },
	};
}

export function listAutomationDraftUpdateFields(update: AutomationDraftUpdate): AutomationDraftField[] {
	const fields: AutomationDraftField[] = [];
	if (update.title !== undefined) {
		fields.push('title');
	}
	if (update.prompt !== undefined) {
		fields.push('prompt');
	}
	if (update.cron !== undefined) {
		fields.push('schedule');
	}
	if (update.webhookEnabled !== undefined) {
		fields.push('webhook');
	}
	if (update.eventTriggers !== undefined) {
		fields.push('feedback');
	}
	if (update.integrations && 'email' in update.integrations) {
		fields.push('email');
	}
	if (update.integrations && 'slack' in update.integrations) {
		fields.push('slack');
	}
	return fields;
}
