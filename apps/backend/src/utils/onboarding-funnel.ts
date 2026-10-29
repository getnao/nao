/* @license Enterprise */

import { onboardingProgress, requestWarehouseCredentials } from '@nao/shared/tools';

import type {
	OnboardingBlocker,
	OnboardingBlockerKind,
	OnboardingEvent,
	OnboardingPath,
	OnboardingStage,
	OnboardingSummary,
} from '../types/onboarding-funnel';
import { ONBOARDING_STAGES } from '../types/onboarding-funnel';
import type { WarehouseConnectionCheckOutcome, WarehouseProvisioningStatus } from '../types/warehouse';

export interface JaffleShopActivityRow {
	firstMessageAt: Date;
	messageCount: number;
}

export interface OnboardingMessageRow {
	createdAt: Date;
	text: string;
}

export interface OnboardingToolCallRow {
	createdAt: Date;
	toolName: string;
	toolInput: unknown;
}

export interface OnboardingAgentErrorRow {
	createdAt: Date;
	errorMessage: string;
}

export interface ConnectionCheckRow {
	createdAt: Date;
	provider: string;
	outcome: WarehouseConnectionCheckOutcome;
	error: string | null;
}

export interface ProvisioningJobRow {
	provider: string;
	status: WarehouseProvisioningStatus;
	failedStatus: WarehouseProvisioningStatus | null;
	error: string | null;
	createdAt: Date;
	updatedAt: Date;
	finishedAt: Date | null;
}

export interface ProjectAccessRow {
	projectName: string;
	createdAt: Date;
}

interface ProgressStep {
	title: string;
	stage: OnboardingStage;
}

const MAX_DETAIL_LENGTH = 500;
const CONTEXT_REQUEST_PREFIX = '[internal:onboarding-context-request]';
const REPORTED_ERROR_ANSWER = 'I ran into an error';

const PATH_BY_FLOW: Record<onboardingProgress.Flow, OnboardingPath> = {
	database: 'cloud',
	new: 'local',
	local: 'local',
	github: 'github',
};

/** Mirrors the step definitions of the onboarding system prompt: index N is "N steps completed". */
const PROGRESS_STEPS: Record<onboardingProgress.Flow, ProgressStep[]> = {
	database: [
		{ title: 'Chose to connect a warehouse', stage: 'onboarding' },
		{ title: 'Connected the warehouse', stage: 'connected' },
		{ title: 'Warehouse initialized and checked, metadata syncing', stage: 'nao_debug' },
	],
	new: [
		{ title: 'Chose to create a project locally', stage: 'connecting' },
		{ title: 'Installed nao-core', stage: 'connecting' },
		{ title: 'Ran nao init', stage: 'nao_init' },
		{ title: 'Ran nao debug and nao sync', stage: 'nao_sync' },
		{ title: 'Deployed the project', stage: 'project_ready' },
	],
	local: [
		{ title: 'Chose to import a local project', stage: 'connecting' },
		{ title: 'Opened the project folder', stage: 'connecting' },
		{ title: 'Ran nao debug', stage: 'nao_debug' },
		{ title: 'Ran nao sync', stage: 'nao_sync' },
		{ title: 'Deployed the project', stage: 'project_ready' },
	],
	github: [
		{ title: 'Chose to import from GitHub', stage: 'connecting' },
		{ title: 'Connected GitHub', stage: 'connected' },
		{ title: 'Imported the repository', stage: 'project_ready' },
	],
};

/** The stage a provisioning job has completed once it reaches a status. */
const STAGE_BY_JOB_STATUS: Record<WarehouseProvisioningStatus, OnboardingStage> = {
	queued: 'connected',
	initializing: 'connected',
	debugging: 'nao_init',
	awaiting_sources: 'nao_debug',
	syncing: 'nao_debug',
	registering: 'nao_sync',
	awaiting_context: 'nao_sync',
	finalizing: 'nao_sync',
	publishing: 'nao_sync',
	ready: 'project_ready',
	failed: 'connected',
	cancelled: 'connected',
};

const JOB_STATUS_LABELS: Record<WarehouseProvisioningStatus, string> = {
	queued: 'queued',
	initializing: 'running nao init',
	debugging: 'running nao debug',
	awaiting_sources: 'waiting for business context',
	syncing: 'running nao sync',
	registering: 'registering the project',
	awaiting_context: 'waiting for business context',
	finalizing: 'generating the rules',
	publishing: 'publishing the project',
	ready: 'ready',
	failed: 'failed',
	cancelled: 'cancelled',
};

const FAILED_STEP_BY_JOB_STATUS: Partial<
	Record<WarehouseProvisioningStatus, { label: string; blocker: OnboardingBlockerKind }>
> = {
	queued: { label: 'before nao init', blocker: 'setup_failed' },
	initializing: { label: 'during nao init', blocker: 'nao_init_failed' },
	debugging: { label: 'during nao debug', blocker: 'nao_debug_failed' },
	awaiting_sources: { label: 'while waiting for business context', blocker: 'setup_failed' },
	syncing: { label: 'during nao sync', blocker: 'nao_sync_failed' },
	registering: { label: 'while registering the project', blocker: 'setup_failed' },
	awaiting_context: { label: 'while waiting for business context', blocker: 'setup_failed' },
	finalizing: { label: 'while generating the rules', blocker: 'setup_failed' },
	publishing: { label: 'while publishing the project', blocker: 'setup_failed' },
};

export function summarizeOnboarding(userId: string, events: OnboardingEvent[]): OnboardingSummary {
	const sorted = sortEvents(events);
	const reachedStages = new Set<OnboardingStage>(['signed_up']);
	let path: OnboardingPath | null = null;
	let provider: string | null = null;
	let blocker: OnboardingBlocker | null = null;

	for (const event of sorted) {
		if (event.stage) {
			reachedStages.add(event.stage);
		}
		path = event.path ?? path;
		provider = event.provider ?? provider;
		if (event.outcome === 'failure' && event.blocker) {
			blocker = { kind: event.blocker, message: event.detail, at: event.at };
		} else if (event.outcome === 'success') {
			blocker = null;
		}
	}

	const stage = furthestStage(reachedStages);
	const isReady = stage === 'project_ready';
	return {
		userId,
		stage,
		reachedStages: ONBOARDING_STAGES.filter((candidate) => reachedStages.has(candidate)),
		path: path ?? (isReady ? 'direct' : null),
		provider,
		blocker: isReady ? null : blocker,
		signedUpAt: sorted.find((event) => event.stage === 'signed_up')?.at ?? null,
		lastEventAt: sorted.at(-1)?.at ?? new Date(0),
	};
}

export function sortEvents(events: OnboardingEvent[]): OnboardingEvent[] {
	return [...events].sort((left, right) => left.at.getTime() - right.at.getTime());
}

export function signedUpEvent(createdAt: Date): OnboardingEvent {
	return buildEvent({ at: createdAt, title: 'Signed up', outcome: 'neutral', stage: 'signed_up' });
}

export function jaffleShopEvent(activity: JaffleShopActivityRow): OnboardingEvent {
	return buildEvent({
		at: activity.firstMessageAt,
		title: 'Messaged the jaffle shop example',
		detail: `${activity.messageCount} ${activity.messageCount === 1 ? 'message' : 'messages'} in total`,
		outcome: 'neutral',
		stage: 'jaffle_shop',
	});
}

export function onboardingMessageEvent(message: OnboardingMessageRow): OnboardingEvent | null {
	const text = message.text.trim();
	if (!text || text.startsWith(CONTEXT_REQUEST_PREFIX)) {
		return null;
	}
	if (text.startsWith(REPORTED_ERROR_ANSWER)) {
		return buildEvent({
			at: message.createdAt,
			title: 'Reported an error',
			outcome: 'failure',
			stage: 'onboarding',
			blocker: 'reported_error',
		});
	}
	return buildEvent({
		at: message.createdAt,
		title: 'Wrote to the onboarding agent',
		detail: truncate(text),
		outcome: 'neutral',
		stage: 'onboarding',
	});
}

export function toolCallEvent(toolCall: OnboardingToolCallRow): OnboardingEvent | null {
	if (toolCall.toolName === 'onboarding_progress') {
		return progressEvent(toolCall);
	}
	if (toolCall.toolName === 'request_warehouse_credentials') {
		return connectionStartedEvent(toolCall);
	}
	if (toolCall.toolName === 'onboarding_command') {
		return commandEvent(toolCall);
	}
	if (toolCall.toolName === 'generate_onboarding_rules') {
		return buildEvent({ at: toolCall.createdAt, title: 'Gave business context', outcome: 'neutral' });
	}
	return null;
}

export function connectionCheckEvent(check: ConnectionCheckRow): OnboardingEvent {
	const providerLabel = labelForProvider(check.provider);
	const common = { at: check.createdAt, path: 'cloud' as const, provider: check.provider, detail: check.error };
	if (check.outcome === 'ok') {
		return buildEvent({
			...common,
			title: `${providerLabel} connection OK`,
			outcome: 'success',
			stage: 'connected',
		});
	}
	if (check.outcome === 'missing_credentials') {
		return buildEvent({
			...common,
			title: `${providerLabel} credentials missing or invalid`,
			outcome: 'failure',
			blocker: 'missing_credentials',
		});
	}
	return buildEvent({
		...common,
		title: `${providerLabel} connection error`,
		outcome: 'failure',
		blocker: 'connection_error',
	});
}

export function provisioningJobEvents(job: ProvisioningJobRow): OnboardingEvent[] {
	const providerLabel = labelForProvider(job.provider);
	const common = { path: 'cloud' as const, provider: job.provider };
	const started = buildEvent({
		...common,
		at: job.createdAt,
		title: `Started the ${providerLabel} cloud setup`,
		outcome: 'success',
		stage: 'connected',
	});
	return [started, provisioningJobOutcomeEvent(job, providerLabel)];
}

export function agentErrorEvent(agentError: OnboardingAgentErrorRow): OnboardingEvent {
	return buildEvent({
		at: agentError.createdAt,
		title: 'The onboarding agent failed',
		detail: truncate(agentError.errorMessage),
		outcome: 'failure',
		blocker: 'agent_error',
	});
}

export function projectAccessEvent(access: ProjectAccessRow): OnboardingEvent {
	return buildEvent({
		at: access.createdAt,
		title: `Got access to ${access.projectName}`,
		outcome: 'success',
		stage: 'project_ready',
	});
}

function progressEvent(toolCall: OnboardingToolCallRow): OnboardingEvent | null {
	const input = onboardingProgress.InputSchema.safeParse(toolCall.toolInput);
	const step = input.success ? PROGRESS_STEPS[input.data.flow][input.data.step] : undefined;
	if (!input.success || !step) {
		return null;
	}
	return buildEvent({
		at: toolCall.createdAt,
		title: step.title,
		outcome: input.data.step === 0 ? 'neutral' : 'success',
		stage: step.stage,
		path: PATH_BY_FLOW[input.data.flow],
	});
}

function connectionStartedEvent(toolCall: OnboardingToolCallRow): OnboardingEvent | null {
	const input = requestWarehouseCredentials.InputSchema.safeParse(toolCall.toolInput);
	if (!input.success) {
		return null;
	}
	return buildEvent({
		at: toolCall.createdAt,
		title: `Started connecting ${labelForProvider(input.data.provider)}`,
		outcome: 'neutral',
		stage: 'connecting',
		path: 'cloud',
		provider: input.data.provider,
	});
}

function commandEvent(toolCall: OnboardingToolCallRow): OnboardingEvent | null {
	const command = isRecord(toolCall.toolInput) ? toolCall.toolInput.command : undefined;
	if (typeof command !== 'string') {
		return null;
	}
	return buildEvent({
		at: toolCall.createdAt,
		title: 'Was given a command to run',
		detail: truncate(command),
		outcome: 'neutral',
	});
}

function provisioningJobOutcomeEvent(job: ProvisioningJobRow, providerLabel: string): OnboardingEvent {
	const common = { path: 'cloud' as const, provider: job.provider, at: job.finishedAt ?? job.updatedAt };
	if (job.status === 'ready') {
		return buildEvent({
			...common,
			title: `${providerLabel} cloud setup finished`,
			outcome: 'success',
			stage: 'project_ready',
		});
	}
	if (job.status === 'failed') {
		const failedStep = job.failedStatus ? FAILED_STEP_BY_JOB_STATUS[job.failedStatus] : undefined;
		return buildEvent({
			...common,
			title: [`${providerLabel} cloud setup failed`, failedStep?.label].filter(Boolean).join(' '),
			detail: job.error,
			outcome: 'failure',
			stage: job.failedStatus ? STAGE_BY_JOB_STATUS[job.failedStatus] : 'connected',
			blocker: failedStep?.blocker ?? 'setup_failed',
		});
	}
	if (job.status === 'cancelled') {
		return buildEvent({ ...common, title: `${providerLabel} cloud setup cancelled`, outcome: 'neutral' });
	}
	return buildEvent({
		...common,
		title: `${providerLabel} cloud setup ${JOB_STATUS_LABELS[job.status]}`,
		outcome: 'success',
		stage: STAGE_BY_JOB_STATUS[job.status],
	});
}

function furthestStage(reachedStages: Set<OnboardingStage>): OnboardingStage {
	return ONBOARDING_STAGES.findLast((stage) => reachedStages.has(stage)) ?? 'signed_up';
}

function buildEvent(
	event: Pick<OnboardingEvent, 'at' | 'title' | 'outcome'> & Partial<OnboardingEvent>,
): OnboardingEvent {
	return { detail: null, stage: null, blocker: null, path: null, provider: null, ...event };
}

function labelForProvider(provider: string): string {
	const labels: Record<string, string> = requestWarehouseCredentials.WAREHOUSE_PROVIDER_LABELS;
	return labels[provider] ?? provider;
}

function truncate(text: string): string {
	return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
