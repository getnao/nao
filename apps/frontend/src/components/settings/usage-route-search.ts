import { CHAT_REPLAY_FEEDBACK_STATES, CHAT_REPLAY_TOOL_STATES, providerLabels } from '@nao/shared/types';
import type { Granularity } from '@nao/backend/usage';
import type { ChatReplayFeedbackState, ChatReplayToolState, LlmProvider } from '@nao/shared/types';

export type TokenChartDisplayMode = 'tokens' | 'dollars';

export type UsageRouteSearch = {
	provider: LlmProvider | 'all';
	granularity: Granularity;
	users: string[] | undefined;
	feedback: ChatReplayFeedbackState[] | undefined;
	tools: ChatReplayToolState[] | undefined;
	tokenView: TokenChartDisplayMode;
};

export const DEFAULT_USAGE_SEARCH: UsageRouteSearch = {
	provider: 'all',
	granularity: 'day',
	users: undefined,
	feedback: undefined,
	tools: undefined,
	tokenView: 'tokens',
};

const granularities = ['hour', 'day', 'month'] as const satisfies readonly Granularity[];
const tokenViews = ['tokens', 'dollars'] as const satisfies readonly TokenChartDisplayMode[];

export function validateUsageSearch(search: Record<string, unknown>): UsageRouteSearch {
	return {
		provider: parseProvider(search.provider),
		granularity: parseOneOf(search.granularity, granularities) ?? 'day',
		users: parseStringArray(search.users),
		feedback: parseArrayOf(search.feedback, CHAT_REPLAY_FEEDBACK_STATES),
		tools: parseArrayOf(search.tools, CHAT_REPLAY_TOOL_STATES),
		tokenView: parseOneOf(search.tokenView, tokenViews) ?? 'tokens',
	};
}

function parseProvider(value: unknown): LlmProvider | 'all' {
	if (value === 'all' || (typeof value === 'string' && value in providerLabels)) {
		return value as LlmProvider | 'all';
	}
	return 'all';
}

function parseStringArray(value: unknown): string[] | undefined {
	const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
	const parsed = values.filter((item): item is string => typeof item === 'string' && item.length > 0);
	return parsed.length ? parsed : undefined;
}

function parseArrayOf<T extends string>(value: unknown, allowedValues: readonly T[]): T[] | undefined {
	const allowed = new Set<string>(allowedValues);
	const parsed = parseStringArray(value)?.filter((item): item is T => allowed.has(item)) ?? [];
	return parsed.length ? parsed : undefined;
}

function parseOneOf<T extends string>(value: unknown, allowedValues: readonly T[]): T | undefined {
	return typeof value === 'string' && allowedValues.includes(value as T) ? (value as T) : undefined;
}
