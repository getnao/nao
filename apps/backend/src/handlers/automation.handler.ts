import type { InferUIMessageChunk } from 'ai';
import { getToolName, isToolUIPart, readUIMessageStream } from 'ai';

import { getTools } from '../agents/tools';
import { renderAutomationRunPrompt } from '../components/ai/automation-run-prompt';
import type { DBAutomationRun, DBScheduledJob } from '../db/abstractSchema';
import type { AutomationWithSchedule } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as chatQueries from '../queries/chat.queries';
import * as userQueries from '../queries/user.queries';
import { agentService } from '../services/agent';
import {
	AUTOMATION_INTEGRATION_TOOL_NAMES,
	type AutomationIntegrationToolName,
	createAutomationTools,
	getAutomationIntegrationToolNames,
	isGithubAutomationTool,
} from '../services/automation-tools';
import { mcpService } from '../services/mcp';
import { skillService } from '../services/skill';
import type { AutomationIntegrationResult } from '../types/automation';
import type { UIMessage, UIMessagePart } from '../types/chat';
import { logger } from '../utils/logger';

export const AUTOMATION_JOB_NAME = 'automation.run';
const STREAM_PERSIST_INTERVAL_MS = 1_000;

type AutomationJobPayload = {
	automationId?: string;
};

type RunAutomationOptions = {
	requireEnabled?: boolean;
};

export async function automationHandler(payload: AutomationJobPayload, _job?: DBScheduledJob): Promise<void> {
	const automationId = payload.automationId;
	if (!automationId) {
		throw new Error('automationId is required.');
	}
	await runAutomation(automationId, { requireEnabled: true });
}

export async function runAutomation(
	automationId: string,
	{ requireEnabled = false }: RunAutomationOptions = {},
): Promise<DBAutomationRun> {
	const { automation, run } = await createAutomationRun(automationId, { requireEnabled });
	return finishAutomationRun(automation, run);
}

export async function startAutomationRun(
	automationId: string,
	{ requireEnabled = false }: RunAutomationOptions = {},
): Promise<DBAutomationRun> {
	const { automation, run } = await createAutomationRun(automationId, { requireEnabled });
	void finishAutomationRun(automation, run).catch(() => undefined);
	return run;
}

async function createAutomationRun(
	automationId: string,
	{ requireEnabled }: Required<RunAutomationOptions>,
): Promise<{ automation: AutomationWithSchedule; run: DBAutomationRun }> {
	const automation = await automationQueries.getAutomationById(automationId);
	if (!automation) {
		throw new Error(`Automation not found: ${automationId}`);
	}
	if (requireEnabled && !automation.enabled) {
		throw new Error(`Automation is disabled: ${automationId}`);
	}

	const run = await automationQueries.createAutomationRun({
		automationId,
		status: 'running',
		integrationResults: [],
	});

	return { automation, run };
}

async function finishAutomationRun(automation: AutomationWithSchedule, run: DBAutomationRun): Promise<DBAutomationRun> {
	const automationId = automation.id;
	try {
		const automationUser = await userQueries.getUser({ id: automation.userId });
		if (!automationUser) {
			throw new Error(`Automation user not found: ${automation.userId}`);
		}

		const [chat] = await chatQueries.createChat(
			{
				title: `${automation.title} run`,
				userId: automation.userId,
				projectId: automation.projectId,
			},
			{
				text: renderAutomationRunPrompt({
					prompt: automation.prompt,
					integrations: automation.integrations,
					userEmail: automationUser.email,
				}),
				source: 'web',
			},
		);
		await automationQueries.attachRunChat(run.id, chat.id);

		const [uiChat] = await chatQueries.getChat(chat.id);
		if (!uiChat) {
			throw new Error(`Automation chat not found after creation: ${chat.id}`);
		}

		if (automation.mcpEnabled) {
			await mcpService.initializeMcpState(automation.projectId);
		}
		await skillService.initializeSkills(automation.projectId);

		const githubToken = await userQueries.getGithubToken(automation.userId);
		const expectedTools = getAutomationIntegrationToolNames(automation.integrations);
		const agent = await agentService.create(
			{ ...uiChat, userId: automation.userId, projectId: automation.projectId },
			automation.modelProvider && automation.modelId
				? { provider: automation.modelProvider, modelId: automation.modelId }
				: undefined,
			{
				excludeFollowUps: true,
				tools: ({ chat: agentChat, agentSettings, webTools }) =>
					getTools(
						agentSettings,
						{
							...(webTools ?? {}),
							...createAutomationTools({
								projectId: automation.projectId,
								chatId: chat.id,
								githubToken,
								integrations: automation.integrations,
							}),
						},
						{
							testMode: agentChat.testMode,
							mcpEnabled: automation.mcpEnabled,
							mcpServers: automation.mcpServers,
							excludeFollowUps: true,
						},
					),
			},
		);

		logger.info('Automation run starting', {
			source: 'system',
			projectId: automation.projectId,
			context: { automationId, runId: run.id, expectedTools },
		});

		// Persist partial UIMessage snapshots while draining server-side so users
		// can open the automation chat and see progress before the stream finishes.
		const stream = agent.stream(uiChat.messages, { timezone: automation.timezone ?? undefined });
		await drainAndPersistStream(stream, chat.id);

		const messages = await chatQueries.getChatMessages(chat.id);
		const assistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
		const integrationResults = extractIntegrationResults(assistantMessage?.parts ?? []);
		const calledTools = new Set(integrationResults.map((entry) => entry.label));
		const missingTools = expectedTools.filter((tool) => !calledTools.has(tool));
		const allToolNames = (assistantMessage?.parts ?? []).filter(isToolUIPart).map((part) => getToolName(part));

		logger.info('Automation run finished agent loop', {
			source: 'system',
			projectId: automation.projectId,
			context: {
				automationId,
				runId: run.id,
				toolCalls: allToolNames,
				calledIntegrations: [...calledTools],
				missingIntegrations: missingTools,
			},
		});

		if (missingTools.length > 0) {
			throw new Error(
				`Agent finished without calling required integration tool(s): ${missingTools.join(', ')}. ` +
					`Tool calls observed: ${allToolNames.join(', ') || '(none)'}`,
			);
		}

		await automationQueries.completeAutomationRun(run.id, integrationResults);
		return { ...run, chatId: chat.id, status: 'completed', completedAt: new Date() };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Automation run failed: ${message}`, {
			source: 'system',
			projectId: automation.projectId,
			context: { automationId, runId: run.id },
		});
		try {
			await automationQueries.failAutomationRun(run.id, message);
		} catch (failErr) {
			const failMessage = failErr instanceof Error ? failErr.message : String(failErr);
			logger.error(`Failed to mark automation run as failed: ${failMessage}`, {
				source: 'system',
				projectId: automation.projectId,
				context: { automationId, runId: run.id },
			});
		}
		throw err;
	}
}

async function drainAndPersistStream(
	stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
	chatId: string,
): Promise<void> {
	const persistence = createStreamPersistence(chatId);
	for await (const message of readUIMessageStream<UIMessage>({ stream })) {
		await persistence.persist(message);
	}
}

function createStreamPersistence(chatId: string) {
	let lastPersistedAt = 0;

	const persistNow = async (message: UIMessage): Promise<void> => {
		if (message.role !== 'assistant' || !isMessageInFlight(message)) {
			return;
		}
		lastPersistedAt = Date.now();
		await chatQueries.upsertMessage({ ...message, chatId }, { updateMetadata: false });
	};

	return {
		async persist(message: UIMessage): Promise<void> {
			if (Date.now() - lastPersistedAt < STREAM_PERSIST_INTERVAL_MS) {
				return;
			}
			await persistNow(message);
		},
	};
}

function isMessageInFlight(message: UIMessage): boolean {
	return message.parts.some((part) => {
		if (isToolUIPart(part)) {
			return part.state === 'input-streaming' || part.state === 'input-available';
		}
		return 'state' in part && part.state === 'streaming';
	});
}

function extractIntegrationResults(parts: UIMessagePart[]): AutomationIntegrationResult[] {
	return parts.flatMap((part): AutomationIntegrationResult[] => {
		if (!isToolUIPart(part)) {
			return [];
		}
		const name = getToolName(part);
		if (!isAutomationIntegrationTool(name)) {
			return [];
		}
		const output = part.state === 'output-available' ? (part.output as { ok?: boolean; url?: string }) : undefined;
		const ok = part.state === 'output-error' ? false : output?.ok !== false;
		return [
			{
				type: integrationTypeFromTool(name),
				label: name,
				ok,
				url: output?.url,
				message: part.state === 'output-error' ? part.errorText : undefined,
			},
		];
	});
}

function isAutomationIntegrationTool(toolName: string): toolName is AutomationIntegrationToolName {
	return (AUTOMATION_INTEGRATION_TOOL_NAMES as readonly string[]).includes(toolName);
}

function integrationTypeFromTool(toolName: AutomationIntegrationToolName): AutomationIntegrationResult['type'] {
	if (toolName === 'send_automation_email') {
		return 'email';
	}
	if (toolName === 'send_automation_slack_message') {
		return 'slack';
	}
	if (isGithubAutomationTool(toolName)) {
		return 'github';
	}
	throw new Error(`Unknown automation integration tool: ${toolName}`);
}
