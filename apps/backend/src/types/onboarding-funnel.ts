/* @license Enterprise */

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
