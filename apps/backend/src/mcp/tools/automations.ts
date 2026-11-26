import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyAutomationDraftUpdate } from '@nao/shared/automation-draft';
import { z } from 'zod/v4';

import type { DBAutomationRun } from '../../db/abstractSchema';
import { env } from '../../env';
import type { AutomationListItem, AutomationWithSchedule } from '../../queries/automation.queries';
import {
	type AutomationActor,
	type AutomationSettings,
	createAutomation,
	deleteAutomation,
	getAutomation,
	getAutomationWithRuns,
	isAutomationPaused,
	listAutomations,
	setAutomationEnabled,
	toAutomationSettings,
	updateAutomation,
} from '../../services/automation.service';
import {
	buildAutomationDraftUpdate,
	describeAutomation,
	updateAutomationInputSchema,
} from '../../services/automation-editor-tools';
import { canRoleReceiveChatFeedback } from '../../services/automation-feedback-trigger.service';
import type { McpContext, ToolResult } from '../logging';
import { automationUrl } from '../urls';
import { errorMessageOf, jsonToolResult, registerMcpTool, type RegisterMcpToolOptions } from './register-mcp-tool';

type AutomationToolInput = z.infer<typeof updateAutomationInputSchema>;

const RECENT_RUN_COUNT = 5;

const NEW_AUTOMATION: AutomationSettings = {
	title: '',
	prompt: '',
	cron: '',
	enabled: true,
	mcpEnabled: true,
	integrations: {},
	webhookEnabled: false,
	eventTriggers: {},
};

const AUTOMATION_ID = z.string().describe('Automation UUID, the `automation_id` that `list_automations` returns.');

const createAutomationInputSchema = updateAutomationInputSchema.omit({ remove_schedule: true }).extend({
	title: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.optional()
		.describe('Title of the automation. nao infers one from the prompt when omitted.'),
	prompt: z
		.string()
		.trim()
		.min(1)
		.max(40_000)
		.describe('What nao does on each run, as instructions to an analyst: what to check, compute and report.'),
});

const LIST_AUTOMATIONS_DESCRIPTION =
	'List the nao automations the user owns or that are shared with them, with their schedule and last run.';

const GET_AUTOMATION_DESCRIPTION =
	'Read one nao automation: prompt, triggers, deliveries, upcoming runs and its latest runs with their errors.';

const CREATE_AUTOMATION_DESCRIPTION =
	'Create a nao automation: instructions the nao agent runs on its own, on a schedule, on a webhook call or on ' +
	'user feedback, then delivers by email or Slack. It is saved and enabled right away, owned by the user.\n\n' +
	'USE WHEN: the user asks for a recurring report, an alert or a check nao should run without them.\n' +
	'Give it at least one trigger: `schedule`, `webhook_enabled` or `feedback_trigger`.';

const UPDATE_AUTOMATION_DESCRIPTION =
	'Change a nao automation the user owns or can edit. Only pass the fields to change; the others keep their value. ' +
	'Call `get_automation` first to read its current prompt and settings.';

const SET_AUTOMATION_ENABLED_DESCRIPTION =
	'Pause or resume a nao automation. A paused automation does not run, on its schedule, its webhook or its ' +
	'feedback trigger.';

const DELETE_AUTOMATION_DESCRIPTION =
	'Delete a nao automation and its run history. Only its owner can delete it. Confirm with the user first.';

/** The automation tools follow the app's automation rules, so a user can do exactly what they can do in the app. */
export function registerAutomationTools(server: McpServer, ctx: McpContext): void {
	if (!env.BETA_AUTOMATIONS_ENABLED) {
		return;
	}
	const actor: AutomationActor = { userId: ctx.userId, projectId: ctx.projectId, role: ctx.role };
	const tools = [
		listAutomationsTool(actor),
		getAutomationTool(actor),
		createAutomationTool(actor),
		updateAutomationTool(actor),
		setAutomationEnabledTool(actor),
		deleteAutomationTool(actor),
	];
	for (const tool of tools) {
		registerMcpTool(server, ctx, tool);
	}
}

function listAutomationsTool(actor: AutomationActor): RegisterMcpToolOptions {
	return {
		name: 'list_automations',
		title: 'List Automations',
		description: LIST_AUTOMATIONS_DESCRIPTION,
		inputSchema: {},
		errorMessage: errorMessageOf('list_automations'),
		handler: async () => {
			const automations = await listAutomations(actor);
			return jsonToolResult({ automations: automations.map(toListedAutomation) });
		},
	};
}

function getAutomationTool(actor: AutomationActor): RegisterMcpToolOptions {
	return {
		name: 'get_automation',
		title: 'Get Automation',
		description: GET_AUTOMATION_DESCRIPTION,
		inputSchema: { automation_id: AUTOMATION_ID },
		errorMessage: errorMessageOf('get_automation'),
		handler: async ({ automation_id }: { automation_id: string }) => {
			const found = await getAutomationWithRuns(actor, automation_id);
			if (!found) {
				return unavailableAutomation(automation_id, 'see');
			}
			return jsonToolResult({
				...toAutomationOutput(found.automation),
				access: found.automation.accessRole,
				recentRuns: found.runs.slice(0, RECENT_RUN_COUNT).map(toRunOutput),
			});
		},
	};
}

function createAutomationTool(actor: AutomationActor): RegisterMcpToolOptions {
	return {
		name: 'create_automation',
		title: 'Create Automation',
		description: CREATE_AUTOMATION_DESCRIPTION,
		inputSchema: createAutomationInputSchema.shape,
		errorMessage: errorMessageOf('create_automation'),
		handler: async (input: AutomationToolInput) => {
			const automation = await createAutomation(actor, applyToolInput(NEW_AUTOMATION, input, actor));
			return jsonToolResult(toAutomationOutput(automation));
		},
	};
}

function updateAutomationTool(actor: AutomationActor): RegisterMcpToolOptions {
	return {
		name: 'update_automation',
		title: 'Update Automation',
		description: UPDATE_AUTOMATION_DESCRIPTION,
		inputSchema: { automation_id: AUTOMATION_ID, ...updateAutomationInputSchema.shape },
		errorMessage: errorMessageOf('update_automation'),
		handler: async ({ automation_id, ...input }: AutomationToolInput & { automation_id: string }) => {
			const current = await getAutomation(actor, automation_id);
			if (!current) {
				return unavailableAutomation(automation_id, 'see');
			}
			const settings = applyToolInput(toAutomationSettings(current), input, actor);
			const automation = await updateAutomation(actor, automation_id, settings);
			if (!automation) {
				return unavailableAutomation(automation_id, 'edit');
			}
			return jsonToolResult(toAutomationOutput(automation));
		},
	};
}

function setAutomationEnabledTool(actor: AutomationActor): RegisterMcpToolOptions {
	return {
		name: 'set_automation_enabled',
		title: 'Set Automation Enabled',
		description: SET_AUTOMATION_ENABLED_DESCRIPTION,
		inputSchema: {
			automation_id: AUTOMATION_ID,
			enabled: z.boolean().describe('False pauses the automation, true resumes it.'),
		},
		errorMessage: errorMessageOf('set_automation_enabled'),
		handler: async ({ automation_id, enabled }: { automation_id: string; enabled: boolean }) => {
			const automation = await setAutomationEnabled(actor, automation_id, enabled);
			if (!automation) {
				return unavailableAutomation(automation_id, 'edit');
			}
			return jsonToolResult({
				automation_id: automation.id,
				title: automation.title,
				paused: isAutomationPaused(automation),
			});
		},
	};
}

function deleteAutomationTool(actor: AutomationActor): RegisterMcpToolOptions {
	return {
		name: 'delete_automation',
		title: 'Delete Automation',
		description: DELETE_AUTOMATION_DESCRIPTION,
		inputSchema: { automation_id: AUTOMATION_ID },
		errorMessage: errorMessageOf('delete_automation'),
		handler: async ({ automation_id }: { automation_id: string }) => {
			if (!(await deleteAutomation(actor, automation_id))) {
				return unavailableAutomation(automation_id, 'delete (only its owner can)');
			}
			return jsonToolResult({ automation_id, deleted: true });
		},
	};
}

/** Tool input is read like the in-app automation editor reads it, then saved through the same checks as the app. */
function applyToolInput(
	settings: AutomationSettings,
	input: AutomationToolInput,
	actor: AutomationActor,
): AutomationSettings {
	const update = buildAutomationDraftUpdate(settings, input, {
		canUseChatFeedback: canRoleReceiveChatFeedback(actor.role),
	});
	return applyAutomationDraftUpdate(settings, update);
}

function toListedAutomation(automation: AutomationListItem) {
	return {
		automation_id: automation.id,
		title: automation.title,
		url: automationUrl(automation.id),
		access: automation.accessRole,
		owner: automation.ownerName,
		paused: isAutomationPaused(automation),
		schedule: automation.cron ? automation.scheduleDescription || automation.cron : null,
		lastRunStatus: automation.lastRunStatus,
		lastRunStartedAt: automation.lastRunStartedAt?.toISOString() ?? null,
	};
}

function toAutomationOutput(automation: AutomationWithSchedule) {
	return {
		automation_id: automation.id,
		url: automationUrl(automation.id),
		paused: isAutomationPaused(automation),
		...describeAutomation(toAutomationSettings(automation)),
	};
}

function toRunOutput(run: DBAutomationRun) {
	return {
		status: run.status,
		trigger: run.trigger,
		startedAt: run.startedAt.toISOString(),
		completedAt: run.completedAt?.toISOString() ?? null,
		error: run.errorMessage,
	};
}
function unavailableAutomation(automationId: string, action: string): ToolResult {
	return errorResult(`No automation "${automationId}" that you can ${action}. Call \`list_automations\` for ids.`);
}

function errorResult(text: string): ToolResult {
	return { content: [{ type: 'text' as const, text }], isError: true };
}
