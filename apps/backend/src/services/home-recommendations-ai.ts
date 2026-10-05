import type { LlmProvider } from '@nao/shared/types';
import { generateText, Output } from 'ai';
import { z } from 'zod/v4';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { logger } from '../utils/logger';
import { describeHour } from './frecency';
import type { HomeRecommendation, HydratedCandidate } from './home-recommendations';

const MAX_OUTPUT_TOKENS = 1024;
const LLM_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60 * 1_000;
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 1_000;
const REASON_MAX_LENGTH = 90;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PicksSchema = z.object({
	picks: z.array(
		z.object({
			candidate: z.number().int(),
			reason: z.string(),
		}),
	),
});

interface CacheEntry {
	expiresAt: number;
	items: HomeRecommendation[] | null;
}

const cache = new Map<string, CacheEntry>();

/**
 * Asks a small model to pick, from the frecency shortlist, the items most likely wanted right now
 * and to phrase why. Returns null when no model is configured or the call fails, so callers can
 * fall back to the plain frecency order.
 */
export async function refineRecommendationsWithAi(input: {
	userId: string;
	projectId: string;
	candidates: HydratedCandidate[];
	localNow: string;
	limit: number;
}): Promise<HomeRecommendation[] | null> {
	if (input.candidates.length <= 1) {
		return null;
	}

	const cacheKey = buildCacheKey(input);
	const cached = readCache(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const modelConfig = await resolveModelForProject(input.projectId);
	if (!modelConfig) {
		return null;
	}

	try {
		const { output } = await generateText({
			...disableModelReasoning(modelConfig.provider, modelConfig.model),
			output: Output.object({ schema: PicksSchema }),
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: buildUserMessage(input) }],
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
			experimental_telemetry: llmTelemetry('nao-home-recommendations', { projectId: input.projectId }),
		});

		const items = applyPicks(output.picks, input.candidates, input.limit);
		writeCache(cacheKey, items, CACHE_TTL_MS);
		return items;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn(`Home recommendations AI re-rank failed, using frecency order: ${message}`, {
			source: 'system',
			projectId: input.projectId,
		});
		writeCache(cacheKey, null, FAILURE_CACHE_TTL_MS);
		return null;
	}
}

const SYSTEM_PROMPT = [
	'You help a data analytics user get back to the stories (dashboards) and chats they need right now.',
	'You receive the current local date and time and a shortlist of items the user has opened recently,',
	'each with usage statistics: how often it was opened, when it was last opened, the hour of day and',
	'weekdays it is usually opened, and a frecency score (higher means more recent and more frequent).',
	'',
	'Pick the items most likely wanted at this moment, best first. Favour clear routines that match the',
	'current time (for example a report checked every weekday morning when it is a weekday morning),',
	'then items that match the current weekday, then generally frequent and recent items. Use the title',
	'as a hint too (for example a "weekly" report near the start of the week, a "month-end" chat near',
	'the end of the month).',
	'',
	'For each pick write one short, concrete reason (max 10 words) in the second person, grounded in the',
	'statistics, such as "Your weekday morning check-in" or "Opened 5 times this week". Never invent',
	'facts that are not supported by the statistics. Return only candidates from the list.',
].join('\n');

function buildUserMessage(input: { candidates: HydratedCandidate[]; localNow: string; limit: number }): string {
	const lines = input.candidates.map((candidate, index) => describeCandidate(candidate, index + 1));
	return [
		`Current local time: ${input.localNow}.`,
		`Pick up to ${input.limit} candidates.`,
		'',
		'Candidates:',
		...lines,
	].join('\n');
}

function describeCandidate({ item, stats }: HydratedCandidate, index: number): string {
	const weekdays = stats.weekdayHistogram
		.map((count, weekday) => (count > 0 ? `${WEEKDAY_SHORT[weekday]}:${count}` : null))
		.filter((entry) => entry !== null)
		.join(' ');
	const peak =
		stats.peakHour !== null
			? `${describeHour(stats.peakHour)} (${Math.round(stats.peakHourShare * 100)}% of opens)`
			: 'none';
	return [
		`${index}. [${item.kind}] "${item.title}"`,
		`   opens (60 days): ${stats.visitCount}, last 7 days: ${stats.visitsLastWeek}`,
		`   last opened: ${formatDaysAgo(stats.lastVisitedDaysAgo)}`,
		`   usual hour: ${peak}; weekdays: ${weekdays || 'n/a'}`,
		`   frecency score: ${stats.score}`,
	].join('\n');
}

function formatDaysAgo(days: number): string {
	if (days < 1) {
		return `${Math.max(1, Math.round(days * 24))}h ago`;
	}
	return `${Math.round(days)}d ago`;
}

function applyPicks(
	picks: Array<{ candidate: number; reason: string }>,
	candidates: HydratedCandidate[],
	limit: number,
): HomeRecommendation[] {
	const seen = new Set<number>();
	const items: HomeRecommendation[] = [];

	for (const pick of picks) {
		const index = pick.candidate - 1;
		if (index < 0 || index >= candidates.length || seen.has(index)) {
			continue;
		}
		seen.add(index);
		const { item } = candidates[index];
		items.push({ ...item, reason: sanitizeReason(pick.reason) ?? item.reason });
		if (items.length >= limit) {
			break;
		}
	}

	for (let index = 0; index < candidates.length && items.length < limit; index++) {
		if (!seen.has(index)) {
			items.push(candidates[index].item);
		}
	}

	return items;
}

function sanitizeReason(reason: string): string | null {
	const cleaned = reason
		.replace(/\s+/g, ' ')
		.replace(/^["'\s]+|["'\s.]+$/g, '')
		.trim();
	if (!cleaned) {
		return null;
	}
	return cleaned.length > REASON_MAX_LENGTH ? `${cleaned.slice(0, REASON_MAX_LENGTH - 1)}…` : cleaned;
}

function buildCacheKey(input: {
	userId: string;
	projectId: string;
	candidates: HydratedCandidate[];
	localNow: string;
	limit: number;
}): string {
	const ids = input.candidates.map(({ item }) => `${item.kind}:${item.id}`).join(',');
	return `${input.userId}|${input.projectId}|${input.localNow}|${input.limit}|${ids}`;
}

function readCache(key: string): HomeRecommendation[] | null | undefined {
	const entry = cache.get(key);
	if (!entry) {
		return undefined;
	}
	if (entry.expiresAt <= Date.now()) {
		cache.delete(key);
		return undefined;
	}
	return entry.items;
}

function writeCache(key: string, items: HomeRecommendation[] | null, ttlMs: number): void {
	if (cache.size >= CACHE_MAX_ENTRIES) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey !== undefined) {
			cache.delete(oldestKey);
		}
	}
	cache.set(key, { expiresAt: Date.now() + ttlMs, items });
}

async function resolveModelForProject(
	projectId: string,
): Promise<{ provider: LlmProvider; model: ProviderModelResult } | null> {
	const pinned = await resolveDefaultModelSelection(projectId, 'other');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}

	const modelId = pinned?.modelId ?? getProviderMeta(provider).extractorModelId;
	const model = await resolveProviderModel(projectId, provider, modelId, false);
	return model ? { provider, model } : null;
}
