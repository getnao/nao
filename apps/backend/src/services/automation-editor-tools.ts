import type { McpServerStatus } from '@nao/shared';
import {
	applyAutomationDraftUpdate,
	type AutomationDraft,
	type AutomationDraftUpdate,
	type AutomationDraftUpdateResult,
	listAutomationDraftUpdateFields,
	UPDATE_AUTOMATION_TOOL_NAME,
} from '@nao/shared/automation-draft';
import { formatSlackChannels, getSlackChannelsSaveError, parseSlackChannels } from '@nao/shared/slack-channels';
import { type AutomationFeedbackTrigger, FEEDBACK_SOURCES, FEEDBACK_VOTES } from '@nao/shared/types';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod/v4';

import * as automationQueries from '../queries/automation.queries';
import type { ToolContext } from '../types/tools';
import { createTool } from '../utils/tools';
import { mcpService } from './mcp';

const UPCOMING_RUN_COUNT = 3;
const MAX_RUN_HISTORY = 20;

export interface UpdateAutomationOutput extends AutomationDraftUpdateResult {
	automation: AutomationSummary;
}

interface AutomationSummary {
	isSaved: boolean;
	title: string;
	prompt: string;
	schedule: ScheduleSummary | null;
	webhookEnabled: boolean;
	naoEvents: { feedback: Pick<AutomationFeedbackTrigger, 'votes' | 'sources'> | null };
	delivery: {
		email: { enabled: boolean; recipients: string[]; subject: string | null } | null;
		slack: { enabled: boolean; channels: string[] } | null;
		github: { enabled: boolean; repositories: string[] } | null;
	};
	model: string;
	mcp: AutomationMcpDefinition;
	missingBeforeSave: string[];
}

interface AutomationMcpDefinition {
	enabled: boolean;
	/** Without a selection, a run may use every MCP server its owner is granted. */
	selection: 'all granted servers' | 'selected servers';
	servers: McpServerDefinition[];
}

interface McpServerDefinition {
	name: string;
	status: McpServerAvailability;
	error?: string;
	/** Folder holding one OpenAPI spec per tool, with its input schema. */
	specFolder: string;
	tools: { name: string; description?: string }[];
}

type McpServerAvailability =
	| 'ready'
	| 'not_discovered'
	| 'disabled'
	| 'needs_user_connection'
	| 'error'
	| 'not_available';

interface ScheduleSummary {
	cron: string;
	description: string | null;
	timezone: string;
	upcomingRuns: string[];
}

const scheduleSchema = z.object({
	cron: z.string().trim().min(1).max(255).describe('A 5-field cron expression, in the schedule timezone.'),
	description: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.describe('Short human label shown in the app, e.g. "Every Monday at 9am".'),
});

const updateAutomationInputSchema = z.object({
	title: z.string().trim().min(1).max(255).optional().describe('New title of the automation.'),
	prompt: z
		.string()
		.trim()
		.min(1)
		.max(40_000)
		.optional()
		.describe(
			'The complete new agent instructions. It replaces the whole prompt: rewrite it in full, keeping what should stay.',
		),
	schedule: scheduleSchema.optional().describe('Runs the automation on this schedule.'),
	remove_schedule: z.boolean().optional().describe('True to stop running the automation on a schedule.'),
	webhook_enabled: z.boolean().optional().describe('Whether a webhook call can trigger the automation.'),
	feedback_trigger: z
		.object({
			enabled: z.boolean().describe('False removes the feedback trigger.'),
			votes: z
				.array(z.enum(FEEDBACK_VOTES))
				.min(1)
				.optional()
				.describe('Which votes run the automation. Omit to keep the current ones.'),
			sources: z
				.array(z.enum(FEEDBACK_SOURCES))
				.min(1)
				.optional()
				.describe('Feedback on chat answers, on stories, or both. Omit to keep the current ones.'),
		})
		.optional()
		.describe(
			'Runs the automation each time a user gives a thumbs up or down; the run receives the vote, comment and rated chat answer or story.',
		),
	email: z
		.object({
			enabled: z.boolean(),
			recipients: z
				.array(z.string().trim())
				.max(100)
				.optional()
				.describe('Replaces the recipients. Omit to keep the current ones.'),
			subject: z.string().trim().max(255).optional(),
		})
		.optional()
		.describe('Email delivery of the run results.'),
	slack: z
		.object({
			enabled: z.boolean(),
			channels: z
				.array(z.string().trim())
				.max(50)
				.optional()
				.describe('Channel ids (C0123456789) or names (#channel-name). Omit to keep the current ones.'),
		})
		.optional()
		.describe('Slack delivery of the run results.'),
});

type UpdateAutomationInput = z.infer<typeof updateAutomationInputSchema>;

/**
 * Tools of a chat editing one automation. They work on the draft the editor sent with the message:
 * changes are applied to the editor's form, and only saved when the user saves it.
 */
export function createAutomationEditorTools({
	draft: initialDraft,
	automationId,
	canUseChatFeedback,
}: {
	draft: AutomationDraft;
	automationId: string | null;
	canUseChatFeedback: boolean;
}): Record<string, unknown> {
	let draft = initialDraft;
	const summarize = async (context: ToolContext) => ({
		...summarizeAutomation(draft, automationId !== null),
		mcp: await describeAutomationMcp(draft, context),
	});

	return {
		get_automation: createTool<Record<string, never>, AutomationSummary>({
			description:
				'Read the automation being edited, as it currently stands in the editor (including unsaved changes): title, prompt, triggers, deliveries, the MCP servers a run can use with their tools, and what is still missing before it can be saved.',
			inputSchema: z.object({}),
			execute: async (_input, context) => summarize(context),
		}),
		[UPDATE_AUTOMATION_TOOL_NAME]: createTool<UpdateAutomationInput, UpdateAutomationOutput>({
			description:
				'Change the automation being edited. Only pass the fields to change. The changes show up in the editor right away; the user reviews and saves them.',
			inputSchema: updateAutomationInputSchema,
			execute: async (input, context) => {
				const update = buildAutomationDraftUpdate(draft, input, { canUseChatFeedback });
				draft = applyAutomationDraftUpdate(draft, update);
				return {
					changedFields: listAutomationDraftUpdateFields(update),
					update,
					automation: await summarize(context),
				};
			},
		}),
		...(automationId && { get_automation_run_history: createRunHistoryTool(automationId) }),
	};
}

export function buildAutomationDraftUpdate(
	draft: AutomationDraft,
	input: UpdateAutomationInput,
	{ canUseChatFeedback }: { canUseChatFeedback: boolean } = { canUseChatFeedback: false },
): AutomationDraftUpdate {
	if (input.schedule && input.remove_schedule) {
		throw new Error('Pass either schedule or remove_schedule, not both.');
	}

	const update: AutomationDraftUpdate = {
		...(input.title !== undefined && { title: input.title }),
		...(input.prompt !== undefined && { prompt: input.prompt }),
		...(input.schedule && buildScheduleUpdate(input.schedule)),
		...(input.remove_schedule && { cron: '', scheduleDescription: '' }),
		...(input.webhook_enabled !== undefined && { webhookEnabled: input.webhook_enabled }),
		...(input.feedback_trigger && {
			eventTriggers: buildEventTriggersUpdate(draft, input.feedback_trigger, canUseChatFeedback),
		}),
		...buildIntegrationsUpdate(draft, input),
	};

	if (listAutomationDraftUpdateFields(update).length === 0) {
		throw new Error('Nothing to change: pass at least one field.');
	}
	return update;
}

function createRunHistoryTool(automationId: string) {
	return createTool({
		description:
			'Look up the latest runs of the automation being edited: status, errors, deliveries and what each run reported. Use it to understand why runs fail or to improve their results.',
		inputSchema: z.object({
			limit: z
				.number()
				.int()
				.min(1)
				.max(MAX_RUN_HISTORY)
				.default(5)
				.describe('How many of the most recent runs to return.'),
		}),
		execute: async ({ limit }) => ({
			runs: await automationQueries.getAutomationRunHistory(automationId, { limit }),
		}),
	});
}

function buildScheduleUpdate(schedule: z.infer<typeof scheduleSchema>): AutomationDraftUpdate {
	assertValidCron(schedule.cron);
	return { cron: schedule.cron, scheduleDescription: schedule.description };
}

function buildEventTriggersUpdate(
	draft: AutomationDraft,
	feedbackTrigger: NonNullable<UpdateAutomationInput['feedback_trigger']>,
	canUseChatFeedback: boolean,
): AutomationDraft['eventTriggers'] {
	const { feedback: current, ...otherEvents } = draft.eventTriggers;
	if (!feedbackTrigger.enabled) {
		return otherEvents;
	}
	const votes = feedbackTrigger.votes ?? current?.votes ?? ['down'];
	const sources = feedbackTrigger.sources ?? current?.sources ?? (canUseChatFeedback ? ['chat', 'story'] : ['story']);
	if (sources.includes('chat') && !canUseChatFeedback) {
		throw new Error(
			'Only admins and context admins can run automations on chat feedback: use sources ["story"] instead.',
		);
	}
	return { ...otherEvents, feedback: { enabled: true, votes, sources } };
}

function buildIntegrationsUpdate(draft: AutomationDraft, input: UpdateAutomationInput): AutomationDraftUpdate {
	if (!input.email && !input.slack) {
		return {};
	}
	return {
		integrations: {
			...(input.email && { email: buildEmailIntegration(draft, input.email) }),
			...(input.slack && { slack: buildSlackIntegration(draft, input.slack) }),
		},
	};
}

function buildEmailIntegration(
	draft: AutomationDraft,
	email: NonNullable<UpdateAutomationInput['email']>,
): NonNullable<AutomationDraft['integrations']['email']> {
	const current = draft.integrations.email;
	const recipients = email.recipients ?? current?.recipients ?? [];
	const subject = email.subject ?? current?.subject;
	if (email.enabled) {
		assertValidEmailRecipients(recipients);
	}
	return { enabled: email.enabled, recipients, ...(subject !== undefined && { subject }) };
}

function buildSlackIntegration(
	draft: AutomationDraft,
	slack: NonNullable<UpdateAutomationInput['slack']>,
): NonNullable<AutomationDraft['integrations']['slack']> {
	const channels = slack.channels ?? parseSlackChannels(draft.integrations.slack?.channelId ?? '');
	const error = slack.enabled ? getSlackChannelsSaveError(channels) : null;
	if (error) {
		throw new Error(error);
	}
	return { enabled: slack.enabled, channelId: formatSlackChannels(channels) };
}

function assertValidCron(cron: string): void {
	if (cron.split(/\s+/).length !== 5) {
		throw new Error(`"${cron}" is not a 5-field cron expression (minute hour day-of-month month day-of-week).`);
	}
	try {
		CronExpressionParser.parse(cron);
	} catch (error) {
		throw new Error(`"${cron}" is not a valid cron expression: ${(error as Error).message}`);
	}
}

function assertValidEmailRecipients(recipients: string[]): void {
	if (recipients.length === 0) {
		throw new Error('Email delivery needs at least one recipient.');
	}
	const invalidRecipients = recipients.filter((recipient) => !z.email().safeParse(recipient).success);
	if (invalidRecipients.length > 0) {
		throw new Error(`Invalid email recipients: ${invalidRecipients.join(', ')}.`);
	}
}

function summarizeAutomation(draft: AutomationDraft, isSaved: boolean): Omit<AutomationSummary, 'mcp'> {
	const { email, slack, github } = draft.integrations;
	return {
		isSaved,
		title: draft.title,
		prompt: draft.prompt,
		schedule: draft.cron ? summarizeSchedule(draft.cron, draft.scheduleDescription) : null,
		webhookEnabled: draft.webhookEnabled,
		naoEvents: { feedback: summarizeFeedbackTrigger(draft.eventTriggers.feedback) },
		delivery: {
			email: email
				? { enabled: email.enabled, recipients: email.recipients, subject: email.subject || null }
				: null,
			slack: slack ? { enabled: slack.enabled, channels: parseSlackChannels(slack.channelId) } : null,
			github: github ? { enabled: github.enabled, repositories: github.repositories } : null,
		},
		model: draft.modelProvider && draft.modelId ? `${draft.modelProvider}:${draft.modelId}` : 'project default',
		missingBeforeSave: listMissingBeforeSave(draft),
	};
}

/** What a run of this automation can reach through MCP, as the user editing it is granted. */
async function describeAutomationMcp(draft: AutomationDraft, context: ToolContext): Promise<AutomationMcpDefinition> {
	const selection = draft.mcpServers ? 'selected servers' : 'all granted servers';
	if (!draft.mcpEnabled) {
		return { enabled: false, selection, servers: [] };
	}
	const statuses = await mcpService.getServersStatus(context.projectId, context.userId, context.mcpAccess);
	const statusByName = new Map(statuses.map((status) => [status.name, status]));
	const serverNames = draft.mcpServers ?? statuses.map((status) => status.name);
	return {
		enabled: true,
		selection,
		servers: serverNames.map((name) => describeMcpServer(name, statusByName.get(name))),
	};
}

function describeMcpServer(name: string, status: McpServerStatus | undefined): McpServerDefinition {
	if (!status) {
		return { name, status: 'not_available', specFolder: '', tools: [] };
	}
	return {
		name,
		status: getMcpServerAvailability(status),
		...(status.error && { error: status.error }),
		specFolder: status.specPath,
		tools: status.tools
			.filter((tool) => tool.enabled)
			.map((tool) => ({ name: tool.name, ...(tool.description && { description: tool.description }) })),
	};
}

function getMcpServerAvailability(status: McpServerStatus): McpServerAvailability {
	if (!status.enabled) {
		return 'disabled';
	}
	if (status.error) {
		return 'error';
	}
	if (status.oauth && !status.oauthConnected) {
		return 'needs_user_connection';
	}
	return status.discovered ? 'ready' : 'not_discovered';
}

function summarizeSchedule(cron: string, description: string | undefined): ScheduleSummary {
	const timezone = getScheduleTimezone();
	return { cron, description: description || null, timezone, upcomingRuns: listUpcomingRuns(cron, timezone) };
}

function listUpcomingRuns(cron: string, timezone: string): string[] {
	const format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' });
	try {
		const interval = CronExpressionParser.parse(cron, { currentDate: new Date() });
		return interval.take(UPCOMING_RUN_COUNT).map((date) => format.format(date.toDate()));
	} catch {
		return [];
	}
}

function summarizeFeedbackTrigger(
	trigger: AutomationFeedbackTrigger | undefined,
): Pick<AutomationFeedbackTrigger, 'votes' | 'sources'> | null {
	return trigger?.enabled ? { votes: trigger.votes, sources: trigger.sources } : null;
}

function listMissingBeforeSave(draft: AutomationDraft): string[] {
	const missing: string[] = [];
	if (!draft.prompt.trim()) {
		missing.push('agent instructions (prompt)');
	}
	if (!draft.cron.trim() && !draft.webhookEnabled && !draft.eventTriggers.feedback?.enabled) {
		missing.push('a trigger: a schedule, the webhook or the feedback trigger');
	}
	return missing;
}

/** Automations are scheduled in the timezone of the server, like the automation routes save them. */
function getScheduleTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
