export const CONTEXT_RECOMMENDATION_RUN_STATUSES = ['running', 'completed', 'failed'] as const;
export type ContextRecommendationRunStatus = (typeof CONTEXT_RECOMMENDATION_RUN_STATUSES)[number];

export const CONTEXT_RECOMMENDATION_RUN_TRIGGERS = ['schedule', 'manual'] as const;
export type ContextRecommendationRunTrigger = (typeof CONTEXT_RECOMMENDATION_RUN_TRIGGERS)[number];

export const CONTEXT_RECOMMENDATION_STATUSES = ['open', 'acknowledged', 'snoozed', 'applied', 'dismissed'] as const;
export type ContextRecommendationStatus = (typeof CONTEXT_RECOMMENDATION_STATUSES)[number];

export const CONTEXT_RECOMMENDATION_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type ContextRecommendationFrequency = (typeof CONTEXT_RECOMMENDATION_FREQUENCIES)[number];

export const DEFAULT_CONTEXT_RECOMMENDATION_FREQUENCY: ContextRecommendationFrequency = 'weekly';

export const MIN_AUTO_PRS_PER_RUN = 1;
export const DEFAULT_MAX_AUTO_PRS_PER_RUN = 3;
export const MAX_AUTO_PRS_PER_RUN = 10;

if (DEFAULT_MAX_AUTO_PRS_PER_RUN < MIN_AUTO_PRS_PER_RUN || DEFAULT_MAX_AUTO_PRS_PER_RUN > MAX_AUTO_PRS_PER_RUN) {
	throw new Error('DEFAULT_MAX_AUTO_PRS_PER_RUN must be within the auto PRs per run validation range.');
}

/** Cron expressions for each frequency. All run at 03:00 UTC. */
export const CONTEXT_RECOMMENDATION_FREQUENCY_CRON: Record<ContextRecommendationFrequency, string> = {
	daily: '0 3 * * *',
	weekly: '0 3 * * 1',
	monthly: '0 3 1 * *',
};

export const CONTEXT_RECOMMENDATION_SEVERITIES = ['high', 'medium', 'low'] as const;
export type ContextRecommendationSeverity = (typeof CONTEXT_RECOMMENDATION_SEVERITIES)[number];

export const CONTEXT_RECOMMENDATION_SIGNAL_TYPES = [
	'tool_error',
	'repeated_correction',
	'downvote_theme',
	'coverage_gap',
	'friction',
] as const;
export type ContextRecommendationSignalType = (typeof CONTEXT_RECOMMENDATION_SIGNAL_TYPES)[number];

export interface RecommendationInsight {
	signalType: ContextRecommendationSignalType;
	metric: string;
	count: number;
	exampleChatIds?: string[];
	snippet?: string;
}

export interface RecommendationImpact {
	affectedChats: number;
	failureShare: number;
}

export const CONTEXT_RECOMMENDATION_FIX_KINDS = ['patch', 'manual'] as const;
export type ContextRecommendationFixKind = (typeof CONTEXT_RECOMMENDATION_FIX_KINDS)[number];

/** Set when an edit targets a linked GitHub repo instead of the context repo. */
export interface ProposedEditTargetRepo {
	repoFullName: string;
	branch: string | null;
	path: string;
}

export interface ProposedEdit {
	path: string;
	kind: 'edit' | 'create';
	oldContent: string;
	newContent: string;
	targetRepo?: ProposedEditTargetRepo;
}

export interface WindowTotals {
	errors: number;
	downvotes: number;
	regenerations: number;
}

export interface LinkedContextRepo {
	name: string;
	contextPath: string;
	url: string | null;
	branch: string | null;
	localPath: string | null;
	repoFullName: string | null;
}
