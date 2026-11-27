import type { InferUIMessageChunk } from 'ai';
import { getToolName, isToolUIPart, readUIMessageStream } from 'ai';

import { automationAgent } from '../agents/profiles/automation';
import { renderAutomationRunPrompt } from '../components/ai/automation-run-prompt';
import type { DBAutomationRun, DBScheduledJob } from '../db/abstractSchema';
import type { AutomationWithSchedule } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as chatQueries from '../queries/chat.queries';
import * as userQueries from '../queries/user.queries';
import { type AgentManager, agentService } from '../services/agent';
import {
	AUTOMATION_INTEGRATION_TOOL_NAMES,
	type AutomationIntegrationToolName,
	createAutomationTools,
	getAutomationIntegrationToolNames,
	isGithubAutomationTool,
	type SlackChannelDelivery,
} from '../services/automation-tools';
import { mcpService } from '../services/mcp';
import { skillService } from '../services/skill';
import type { AutomationIntegrationResult, AutomationRunTrigger, AutomationTriggerEvent } from '../types/automation';
import type { UIMessage, UIMessagePart } from '../types/chat';
import { logger } from '../utils/logger';

export const AUTOMATION_JOB_NAME = 'automation.run';
const STREAM_PERSIST_INTERVAL_MS = 1_000;
const AUTOMATION_RUN_INTERRUPTED_MESSAGE = 'The automation run was interrupted because the server running it stopped.';
const INTERRUPTED_AGENT_WAIT_MS = 5_000;

interface RunningAutomation {
	isInterrupted: boolean;
	agent?: Pick<AgentManager, 'stop' | 'waitUntilFinished'>;
}

/** The automation runs in progress on this instance, by run id. Each gets its agent once its stream starts. */
const runningAutomations = new Map<string, RunningAutomation>();

type AutomationJobPayload = {
	automationId?: string;
};

type IntegrationToolOutput = {
	ok?: boolean;
	url?: string;
	deliveries?: SlackChannelDelivery[];
};

type RunAutomationOptions = {
	trigger: AutomationRunTrigger;
	billingAccessVerifiedProjectId?: string;
	requireEnabled?: boolean;
	triggerEvent?: AutomationTriggerEvent;
};

export async function automationHandler(payload: AutomationJobPayload, _job?: DBScheduledJob): Promise<void> {
	const automationId = payload.automationId;
	if (!automationId) {
		throw new Error('automationId is required.');
	}
	const automation = await automationQueries.getAutomationById(automationId);
	if (!automation) {
		throw new Error(`Automation not found: ${automationId}`);
	}
	await runAutomation(automationId, {
		billingAccessVerifiedProjectId: automation.projectId,
		requireEnabled: true,
		trigger: 'schedule',
	});
}

export async function resolveAutomationProjectId(payload: AutomationJobPayload): Promise<string> {
	const automationId = payload.automationId;
	if (!automationId) {
		throw new Error('automationId is required.');
	}
	const automation = await automationQueries.getAutomationById(automationId);
	if (!automation) {
		throw new Error(`Automation not found: ${automationId}`);
	}
	return automation.projectId;
}

/** Fails the automation runs of this instance and stops their agents, so a restart never leaves a run going. */
export async function interruptRunningAutomations(): Promise<void> {
	const interruptions = [...runningAutomations].map(([runId, running]) => interruptAutomationRun(runId, running));
	const results = await Promise.allSettled(interruptions);
	results
		.filter((result) => result.status === 'rejected')
		.forEach((result) =>
			logger.error(`Failed to interrupt an automation run: ${String(result.reason)}`, { source: 'system' }),
		);
}

export async function runAutomation(
	automationId: string,
	{ billingAccessVerifiedProjectId, requireEnabled = false, trigger, triggerEvent }: RunAutomationOptions,
): Promise<DBAutomationRun> {
	const { automation, run } = await createAutomationRun(automationId, { requireEnabled, trigger });
	return finishAutomationRun(automation, run, { billingAccessVerifiedProjectId, triggerEvent });
}

export async function startAutomationRun(
	automationId: string,
	{ billingAccessVerifiedProjectId, requireEnabled = false, trigger, triggerEvent }: RunAutomationOptions,
): Promise<DBAutomationRun> {
	const { automation, run } = await createAutomationRun(automationId, { requireEnabled, trigger });
	void finishAutomationRun(automation, run, { billingAccessVerifiedProjectId, triggerEvent }).catch(() => undefined);
	return run;
}

async function createAutomationRun(
	automationId: string,
	{ requireEnabled, trigger }: { requireEnabled: boolean; trigger: AutomationRunTrigger },
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
		llmConfigId: automation.llmConfigId,
		status: 'running',
		trigger,
		integrationResults: [],
	});

	return { automation, run };
}

async function finishAutomationRun(
	automation: AutomationWithSchedule,
	run: DBAutomationRun,
	{
		billingAccessVerifiedProjectId,
		triggerEvent,
	}: Pick<RunAutomationOptions, 'billingAccessVerifiedProjectId' | 'triggerEvent'>,
): Promise<DBAutomationRun> {
	const automationId = automation.id;
	const running: RunningAutomation = { isInterrupted: false };
	runningAutomations.set(run.id, running);
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
					triggerEvent,
				}),
				source: 'automation',
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
		const integrationTools = createAutomationTools({
			automationId: automation.id,
			currentRunId: run.id,
			projectId: automation.projectId,
			chatId: chat.id,
			githubToken,
			integrations: automation.integrations,
		});
		const agent = await agentService.create(
			{ ...uiChat, userId: automation.userId, projectId: automation.projectId },
			automation.modelProvider && automation.modelId
				? {
						provider: automation.modelProvider,
						modelId: automation.modelId,
						...(automation.llmConfigId && { llmConfigId: automation.llmConfigId }),
					}
				: undefined,
			automationAgent(automation, integrationTools),
			{ billingAccessVerifiedProjectId },
		);
		await automationQueries.setRunLlmConfig(run.id, agent.getModelSelection().llmConfigId ?? null);

		logger.info('Automation run starting', {
			source: 'system',
			projectId: automation.projectId,
			context: { automationId, runId: run.id, expectedTools },
		});

		// Persist partial UIMessage snapshots while draining server-side so users
		// can open the automation chat and see progress before the stream finishes.
		if (running.isInterrupted) {
			throw new Error(AUTOMATION_RUN_INTERRUPTED_MESSAGE);
		}
		running.agent = agent;
		const stream = agent.stream(uiChat.messages, { timezone: automation.timezone ?? undefined });
		const streamError = await drainAndPersistStream(stream, chat.id, () => agent.isStopped);

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

		if (missingTools.length > 0 && streamError) {
			throw new Error(`Model error: ${streamError}`);
		}
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
	} finally {
		runningAutomations.delete(run.id);
	}
}

/**
 * Fails the run before stopping its agent, so the failure of the cut agent loop never replaces the reason.
 * A run still setting up sees the flag and never starts its agent.
 */
async function interruptAutomationRun(runId: string, running: RunningAutomation): Promise<void> {
	running.isInterrupted = true;
	try {
		await automationQueries.failAutomationRun(runId, AUTOMATION_RUN_INTERRUPTED_MESSAGE);
	} finally {
		running.agent?.stop();
		await waitForAgentToSettle(runId, running.agent);
	}
}

async function waitForAgentToSettle(runId: string, agent: RunningAutomation['agent']): Promise<void> {
	if (!agent) {
		return;
	}
	let timer: NodeJS.Timeout | undefined;
	const deadline = new Promise<'timeout'>((resolve) => {
		timer = setTimeout(() => resolve('timeout'), INTERRUPTED_AGENT_WAIT_MS).unref();
	});
	const outcome = await Promise.race([agent.waitUntilFinished(), deadline]);
	clearTimeout(timer);
	if (outcome === 'timeout') {
		logger.error('An interrupted automation agent did not save its answer in time', {
			source: 'system',
			context: { runId },
		});
	}
}

/**
 * Stops saving snapshots once the agent is stopped, since the agent then saves the settled answer itself.
 * Resolves with the last error the agent streamed, such as a provider rejecting the request.
 */
async function drainAndPersistStream(
	stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
	chatId: string,
	isStopped: () => boolean,
): Promise<string | undefined> {
	const persistence = createStreamPersistence(chatId);
	let streamError: string | undefined;
	const onError = (error: unknown) => {
		streamError = readStreamErrorText(error instanceof Error ? error.message : String(error));
	};
	for await (const message of readUIMessageStream<UIMessage>({ stream, onError })) {
		if (!isStopped()) {
			await persistence.persist(message);
		}
	}
	return streamError;
}

/** Stream errors can be JSON payloads meant for the chat UI; keep only their message. */
function readStreamErrorText(errorText: string): string {
	try {
		const payload = JSON.parse(errorText);
		const message = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
		return typeof message === 'string' ? message : errorText;
	} catch {
		return errorText;
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
		const output = part.state === 'output-available' ? (part.output as IntegrationToolOutput) : undefined;
		const type = integrationTypeFromTool(name);
		if (output?.deliveries) {
			return output.deliveries.map((delivery) => ({
				type,
				label: name,
				ok: delivery.ok,
				message: delivery.error,
				destination: delivery.channel,
			}));
		}
		const ok = part.state === 'output-error' ? false : output?.ok !== false;
		return [
			{
				type,
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
