/* @license Enterprise */

import type { WarehouseProvisioningStatus, WarehouseProvisioningStep } from './warehouse';

export const ONBOARDING_STAGES = [
	'signed_up',
	'jaffle_shop',
	'onboarding',
	'connecting',
	'connected',
	'nao_init',
	'nao_debug',
	'nao_sync',
	'project_ready',
] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

/** `direct` users have a project without going through onboarding, usually because they were invited. */
export const ONBOARDING_PATHS = ['cloud', 'local', 'github', 'direct'] as const;

export type OnboardingPath = (typeof ONBOARDING_PATHS)[number];

export const ONBOARDING_BLOCKERS = [
	'connection_error',
	'missing_credentials',
	'nao_init_failed',
	'nao_debug_failed',
	'nao_sync_failed',
	'rules_failed',
	'publishing_failed',
	'setup_failed',
	'reported_error',
	'agent_error',
] as const;

export type OnboardingBlockerKind = (typeof ONBOARDING_BLOCKERS)[number];

export type OnboardingEventOutcome = 'success' | 'failure' | 'neutral';

export interface OnboardingEvent {
	at: Date;
	title: string;
	detail: string | null;
	outcome: OnboardingEventOutcome;
	stage: OnboardingStage | null;
	blocker: OnboardingBlockerKind | null;
	path: OnboardingPath | null;
	provider: string | null;
}

export interface OnboardingBlocker {
	kind: OnboardingBlockerKind;
	message: string | null;
	at: Date;
}

export interface OnboardingSummary {
	userId: string;
	stage: OnboardingStage;
	reachedStages: OnboardingStage[];
	path: OnboardingPath | null;
	provider: string | null;
	blocker: OnboardingBlocker | null;
	signedUpAt: Date | null;
	lastEventAt: Date;
}

/** One cloud warehouse setup as stored, to debug where it is or why it stopped; `error` is what the user saw. */
export interface OnboardingSetupTrace {
	id: string;
	chatId: string | null;
	projectId: string | null;
	projectName: string;
	provider: string;
	status: WarehouseProvisioningStatus;
	failedStatus: WarehouseProvisioningStatus | null;
	steps: WarehouseProvisioningStep[];
	error: string | null;
	errorDetail: string | null;
	logs: string | null;
	workerId: string | null;
	heartbeatAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	finishedAt: Date | null;
}

export interface OnboardingSetupFailure {
	id: string;
	userId: string;
	userEmail: string;
	projectName: string;
	provider: string;
	failedStatus: WarehouseProvisioningStatus | null;
	error: string | null;
	errorDetail: string | null;
	failedAt: Date;
}
