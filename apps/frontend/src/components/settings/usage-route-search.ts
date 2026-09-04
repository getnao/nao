import { CHAT_REPLAY_FEEDBACK_STATES, CHAT_REPLAY_TOOL_STATES, providerLabels } from '@nao/shared/types';
import { USAGE_PERIOD_PRESET_NAMES, USAGE_SOURCES } from '@nao/backend/usage';
import type { UsagePeriodPreference, UsagePeriodPreset, UsageSource } from '@nao/backend/usage';
import type { ChatReplayFeedbackState, ChatReplayToolState, LlmProvider } from '@nao/shared/types';
import type { RecommendationTab } from '@/components/settings/recommendations-route-search';
import { RECOMMENDATION_TABS } from '@/components/settings/recommendations-route-search';
import { getActiveProjectId } from '@/lib/active-project';

export type TokenChartDisplayMode = 'tokens' | 'dollars';

export type ReplayHighlight = 'tool-error' | 'feedback';

export type ReplayOrigin = 'recommendations';

export type UsageRouteSearch = {
	provider: LlmProvider | 'all';
	periodMode: UsagePeriodPreset | undefined;
	periodEntryId: string | undefined;
	users: string[] | undefined;
	feedback: ChatReplayFeedbackState[] | undefined;
	tools: ChatReplayToolState[] | undefined;
	sources: UsageSource[] | undefined;
	tokenView: TokenChartDisplayMode;
	highlight: ReplayHighlight | undefined;
	targetId: string | undefined;
	origin: ReplayOrigin | undefined;
	recoId: string | undefined;
	recoTab: RecommendationTab | undefined;
};

export const DEFAULT_USAGE_SEARCH: UsageRouteSearch = {
	provider: 'all',
	periodMode: undefined,
	periodEntryId: undefined,
	users: undefined,
	feedback: undefined,
	tools: undefined,
	sources: undefined,
	tokenView: 'tokens',
	highlight: undefined,
	targetId: undefined,
	origin: undefined,
	recoId: undefined,
	recoTab: undefined,
};

const tokenViews = ['tokens', 'dollars'] as const satisfies readonly TokenChartDisplayMode[];
const filterSearchKeys = ['provider', 'users', 'feedback', 'tools', 'sources'] as const;
const periodSearchKeys = ['periodMode', 'periodValue', 'periodUnit', 'periodEntryId', 'period', 'granularity'] as const;
const usageFiltersStorageKey = 'nao.usage-filters';

export function validateUsageSearchWithStoredFilters(search: Record<string, unknown>): UsageRouteSearch {
	const hasSearchFilters = [...filterSearchKeys, ...periodSearchKeys].some((key) => search[key] !== undefined);
	const storedFilters = hasSearchFilters ? {} : pickUsageFilters(readStoredUsageFilters());

	return validateUsageSearch({ ...storedFilters, ...search });
}

export function saveUsageFilters(search: UsageRouteSearch): void {
	if (typeof window === 'undefined') {
		return;
	}

	const storageKey = getUsageFiltersStorageKey();
	const storedPeriod = parsePeriodSearch(readStoredUsageFilters(storageKey));
	const filters = {
		...(storedPeriod.mode ? { periodMode: storedPeriod.mode } : {}),
		...pickUsageFilters(search),
	};

	try {
		localStorage.setItem(storageKey, JSON.stringify(filters));
	} catch {
		return;
	}
}

export function readStoredUsagePeriodPreference(projectId: string | null): UsagePeriodPreference | undefined {
	const period = parsePeriodSearch(readStoredUsageFilters(getUsageFiltersStorageKey(projectId ?? 'default')));
	if (!period.mode) {
		return undefined;
	}

	return { mode: period.mode };
}

export function clearStoredUsagePeriodPreference(projectId: string): void {
	if (typeof window === 'undefined') {
		return;
	}

	const storageKey = getUsageFiltersStorageKey(projectId);
	const filters = readStoredUsageFilters(storageKey);
	for (const key of periodSearchKeys) {
		delete filters[key];
	}

	try {
		localStorage.setItem(storageKey, JSON.stringify(filters));
	} catch {
		return;
	}
}

const replayHighlights = ['tool-error', 'feedback'] as const satisfies readonly ReplayHighlight[];
const replayOrigins = ['recommendations'] as const satisfies readonly ReplayOrigin[];

export function validateUsageSearch(search: Record<string, unknown>): UsageRouteSearch {
	const period = parsePeriodSearch(search);

	return {
		provider: parseProvider(search.provider),
		periodMode: period.mode,
		periodEntryId:
			typeof search.periodEntryId === 'string' && search.periodEntryId.length > 0
				? search.periodEntryId
				: undefined,
		users: parseStringArray(search.users),
		feedback: parseArrayOf(search.feedback, CHAT_REPLAY_FEEDBACK_STATES),
		tools: parseArrayOf(search.tools, CHAT_REPLAY_TOOL_STATES),
		sources: parseArrayOf(search.sources, USAGE_SOURCES),
		tokenView: parseOneOf(search.tokenView, tokenViews) ?? 'tokens',
		highlight: parseOneOf(search.highlight, replayHighlights),
		targetId: typeof search.targetId === 'string' && search.targetId.length > 0 ? search.targetId : undefined,
		origin: parseOneOf(search.origin, replayOrigins),
		recoId: typeof search.recoId === 'string' && search.recoId.length > 0 ? search.recoId : undefined,
		recoTab: parseOneOf(search.recoTab, RECOMMENDATION_TABS),
	};
}

function readStoredUsageFilters(storageKey = getUsageFiltersStorageKey()): Record<string, unknown> {
	if (typeof window === 'undefined') {
		return {};
	}

	try {
		const stored = localStorage.getItem(storageKey);
		const parsed = stored ? JSON.parse(stored) : null;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function getUsageFiltersStorageKey(projectId = getActiveProjectId() ?? 'default'): string {
	return `${usageFiltersStorageKey}.${projectId}`;
}

function pickUsageFilters(filters: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(filterSearchKeys.map((key) => [key, filters[key]]));
}

function parsePeriodSearch(search: Record<string, unknown>): { mode: UsagePeriodPreset | undefined } {
	const mode = parseOneOf(search.periodMode, USAGE_PERIOD_PRESET_NAMES);
	if (mode) {
		return { mode };
	}

	return parseLegacyPeriod(search.period, search.granularity);
}

function parseLegacyPeriod(rawPeriod: unknown, rawGranularity: unknown): { mode: UsagePeriodPreset | undefined } {
	switch (rawPeriod) {
		case '24h':
		case '15d':
		case '6m':
			return { mode: rawPeriod };
	}

	switch (rawGranularity) {
		case 'hour':
			return { mode: '24h' };
		case 'day':
			return { mode: '15d' };
		case 'month':
			return { mode: '6m' };
		default:
			return { mode: undefined };
	}
}

function parseProvider(value: unknown): LlmProvider | 'all' {
	if (value === 'all' || (typeof value === 'string' && Object.hasOwn(providerLabels, value))) {
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
