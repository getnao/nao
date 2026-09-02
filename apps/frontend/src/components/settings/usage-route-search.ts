import { CHAT_REPLAY_FEEDBACK_STATES, CHAT_REPLAY_TOOL_STATES, providerLabels } from '@nao/shared/types';
import {
	DEFAULT_USAGE_PERIOD_PREFERENCE,
	USAGE_PERIOD_LIMITS,
	USAGE_PERIOD_MODES,
	USAGE_PERIOD_UNITS,
	USAGE_SOURCES,
} from '@nao/backend/usage';
import type { UsagePeriodMode, UsagePeriodPreference, UsagePeriodUnit, UsageSource } from '@nao/backend/usage';
import type { ChatReplayFeedbackState, ChatReplayToolState, LlmProvider } from '@nao/shared/types';
import type { RecommendationTab } from '@/components/settings/recommendations-route-search';
import { RECOMMENDATION_TABS } from '@/components/settings/recommendations-route-search';
import { getActiveProjectId } from '@/lib/active-project';

export type TokenChartDisplayMode = 'tokens' | 'dollars';

export type ReplayHighlight = 'tool-error' | 'feedback';

export type ReplayOrigin = 'recommendations';

export type UsageRouteSearch = {
	provider: LlmProvider | 'all';
	periodMode: UsagePeriodMode | undefined;
	periodValue: number | undefined;
	periodUnit: UsagePeriodUnit | undefined;
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
	periodValue: undefined,
	periodUnit: undefined,
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
const periodSearchKeys = ['periodMode', 'periodValue', 'periodUnit', 'period', 'granularity'] as const;
const usageFiltersStorageKey = 'nao.usage-filters';

export function validateUsageSearchWithStoredFilters(search: Record<string, unknown>): UsageRouteSearch {
	const hasSearchFilters = [...filterSearchKeys, ...periodSearchKeys].some((key) => search[key] !== undefined);
	const storedFilters = hasSearchFilters ? {} : readStoredUsageFilters();

	return validateUsageSearch({ ...storedFilters, ...search });
}

export function saveUsageFilters(search: UsageRouteSearch): void {
	if (typeof window === 'undefined') {
		return;
	}

	const filters = Object.fromEntries(filterSearchKeys.map((key) => [key, search[key]]));

	try {
		localStorage.setItem(getUsageFiltersStorageKey(), JSON.stringify(filters));
	} catch {
		return;
	}
}

export function readStoredUsagePeriodPreference(): UsagePeriodPreference | undefined {
	const period = parsePeriodSearch(readStoredUsageFilters());
	if (!period.mode) {
		return undefined;
	}

	return {
		mode: period.mode,
		customPeriod:
			period.value && period.unit
				? { value: period.value, unit: period.unit }
				: DEFAULT_USAGE_PERIOD_PREFERENCE.customPeriod,
	};
}

const replayHighlights = ['tool-error', 'feedback'] as const satisfies readonly ReplayHighlight[];
const replayOrigins = ['recommendations'] as const satisfies readonly ReplayOrigin[];

export function validateUsageSearch(search: Record<string, unknown>): UsageRouteSearch {
	const period = parsePeriodSearch(search);

	return {
		provider: parseProvider(search.provider),
		periodMode: period.mode,
		periodValue: period.value,
		periodUnit: period.unit,
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

function readStoredUsageFilters(): Record<string, unknown> {
	if (typeof window === 'undefined') {
		return {};
	}

	try {
		const stored = localStorage.getItem(getUsageFiltersStorageKey());
		const parsed = stored ? JSON.parse(stored) : null;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function getUsageFiltersStorageKey(): string {
	return `${usageFiltersStorageKey}.${getActiveProjectId() ?? 'default'}`;
}

function parsePeriodSearch(search: Record<string, unknown>): {
	mode: UsagePeriodMode | undefined;
	value: number | undefined;
	unit: UsagePeriodUnit | undefined;
} {
	const mode = parseOneOf(search.periodMode, USAGE_PERIOD_MODES);
	if (mode) {
		const customPeriod = parseCustomPeriod(search.periodValue, search.periodUnit);
		return { mode, value: customPeriod?.value, unit: customPeriod?.unit };
	}

	return parseLegacyPeriod(search.period, search.granularity);
}

function parseCustomPeriod(rawValue: unknown, rawUnit: unknown): { value: number; unit: UsagePeriodUnit } | undefined {
	const unit = parseOneOf(rawUnit, USAGE_PERIOD_UNITS);
	const value =
		typeof rawValue === 'number'
			? rawValue
			: typeof rawValue === 'string' && rawValue.trim() !== ''
				? Number(rawValue)
				: Number.NaN;

	if (!unit || !Number.isInteger(value) || value < 1 || value > USAGE_PERIOD_LIMITS[unit]) {
		return undefined;
	}

	return { value, unit };
}

function parseLegacyPeriod(
	rawPeriod: unknown,
	rawGranularity: unknown,
): { mode: UsagePeriodMode | undefined; value: number | undefined; unit: UsagePeriodUnit | undefined } {
	switch (rawPeriod) {
		case '24h':
		case '15d':
		case '6m':
			return { mode: rawPeriod, value: undefined, unit: undefined };
		case '30d':
			return { mode: 'custom', value: 30, unit: 'day' };
	}

	switch (rawGranularity) {
		case 'hour':
			return { mode: '24h', value: undefined, unit: undefined };
		case 'day':
			return { mode: '15d', value: undefined, unit: undefined };
		case 'month':
			return { mode: '6m', value: undefined, unit: undefined };
		default:
			return { mode: undefined, value: undefined, unit: undefined };
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
