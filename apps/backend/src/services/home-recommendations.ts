import type { AnalyticsAssetType, MessageBubble } from '@nao/shared/types';

import * as chatQueries from '../queries/chat.queries';
import * as homeRecommendationQueries from '../queries/home-recommendation.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as storyQueries from '../queries/story.queries';
import { type FrecencyCandidate, rankByFrecency, toLocalMoment } from './frecency';
import { refineRecommendationsWithAi } from './home-recommendations-ai';

export interface HomeRecommendation {
	kind: AnalyticsAssetType;
	id: string;
	shareId: string | null;
	isOwn: boolean;
	title: string;
	authorName: string;
	createdAt: Date;
	reason: string;
	score: number;
	messageBubbles?: MessageBubble[];
}

export interface HomeRecommendationsResult {
	items: HomeRecommendation[];
	source: 'frecency' | 'ai';
}

const HISTORY_WINDOW_DAYS = 60;
const MAX_EVENTS = 5_000;
/** How many frecency candidates are hydrated and offered to the AI re-ranker. */
const CANDIDATE_POOL_SIZE = 12;
const DAY_MS = 24 * 60 * 60 * 1_000;

export async function getHomeRecommendations(input: {
	userId: string;
	projectId: string;
	timezone: string;
	limit: number;
	now?: Date;
}): Promise<HomeRecommendationsResult> {
	const now = input.now ?? new Date();
	const visits = await homeRecommendationQueries.listUserPageViews({
		userId: input.userId,
		projectId: input.projectId,
		since: new Date(now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS),
		limit: MAX_EVENTS,
	});
	if (visits.length === 0) {
		return { items: [], source: 'frecency' };
	}

	const ranked = rankByFrecency(visits, now, input.timezone);
	const pool = await hydrateCandidates(ranked, input.userId, CANDIDATE_POOL_SIZE);
	if (pool.length === 0) {
		return { items: [], source: 'frecency' };
	}

	const refined = await refineRecommendationsWithAi({
		userId: input.userId,
		projectId: input.projectId,
		candidates: pool,
		localNow: toLocalMoment(now, input.timezone).label,
		limit: input.limit,
	});
	if (refined) {
		return { items: refined, source: 'ai' };
	}

	return { items: pool.map((entry) => entry.item).slice(0, input.limit), source: 'frecency' };
}

export interface HydratedCandidate {
	item: HomeRecommendation;
	stats: FrecencyCandidate;
}

/** Walks the ranked candidates in order and keeps the first ones the user can still open. */
async function hydrateCandidates(
	ranked: FrecencyCandidate[],
	userId: string,
	size: number,
): Promise<HydratedCandidate[]> {
	const hydrated: HydratedCandidate[] = [];
	const batchSize = size * 2;

	for (let offset = 0; offset < ranked.length && hydrated.length < size; offset += batchSize) {
		const batch = ranked.slice(offset, offset + batchSize);
		const items = await hydrateBatch(batch, userId);
		for (const candidate of batch) {
			const item = items.get(candidateKey(candidate));
			if (item) {
				hydrated.push({ item, stats: candidate });
			}
			if (hydrated.length >= size) {
				break;
			}
		}
	}

	return hydrated;
}

async function hydrateBatch(batch: FrecencyCandidate[], userId: string): Promise<Map<string, HomeRecommendation>> {
	const chatIds = batch.filter((c) => c.assetType === 'chat').map((c) => c.assetId);
	const storyIds = batch.filter((c) => c.assetType === 'story').map((c) => c.assetId);

	const [chats, stories] = await Promise.all([
		homeRecommendationQueries.getChatCandidates(chatIds),
		homeRecommendationQueries.getStoryCandidates(storyIds),
	]);
	const chatById = new Map(chats.map((chat) => [chat.id, chat]));
	const storyById = new Map(stories.map((story) => [story.id, story]));

	const entries = await Promise.all(
		batch.map(async (candidate): Promise<[string, HomeRecommendation] | null> => {
			const item =
				candidate.assetType === 'chat'
					? await toChatRecommendation(candidate, chatById.get(candidate.assetId), userId)
					: await toStoryRecommendation(candidate, storyById.get(candidate.assetId), userId);
			return item ? [candidateKey(candidate), item] : null;
		}),
	);

	const result = new Map(entries.filter((entry): entry is [string, HomeRecommendation] => entry !== null));
	await attachMessageBubbles(result);
	return result;
}

async function toChatRecommendation(
	candidate: FrecencyCandidate,
	chat: homeRecommendationQueries.ChatCandidateRow | undefined,
	userId: string,
): Promise<HomeRecommendation | null> {
	if (!chat || chat.isAutomationRun) {
		return null;
	}
	const isOwn = chat.ownerId === userId;
	if (!isOwn && !(await chatQueries.canUserAccessChat(chat.id, userId))) {
		return null;
	}
	if (!isOwn && !candidate.shareId) {
		return null;
	}
	return {
		kind: 'chat',
		id: chat.id,
		shareId: isOwn ? null : candidate.shareId,
		isOwn,
		title: chat.title,
		authorName: chat.ownerName,
		createdAt: chat.createdAt,
		reason: candidate.reason,
		score: candidate.score,
	};
}

async function toStoryRecommendation(
	candidate: FrecencyCandidate,
	story: homeRecommendationQueries.StoryCandidateRow | undefined,
	userId: string,
): Promise<HomeRecommendation | null> {
	if (!story) {
		return null;
	}
	const isOwn = story.ownerId === userId;
	if (!isOwn && !(await storyQueries.canUserAccessStory(story.id, userId))) {
		return null;
	}
	return {
		kind: 'story',
		id: story.id,
		shareId: isOwn ? null : candidate.shareId,
		isOwn,
		title: story.title,
		authorName: story.ownerName ?? '',
		createdAt: story.createdAt,
		reason: candidate.reason,
		score: candidate.score,
	};
}

async function attachMessageBubbles(items: Map<string, HomeRecommendation>): Promise<void> {
	const chatIds = [...items.values()].filter((item) => item.kind === 'chat').map((item) => item.id);
	if (chatIds.length === 0) {
		return;
	}
	const bubbles = await sharedChatQueries.fetchMessageBubbles(chatIds);
	for (const item of items.values()) {
		if (item.kind === 'chat') {
			item.messageBubbles = bubbles.get(item.id) ?? [];
		}
	}
}

function candidateKey(candidate: FrecencyCandidate): string {
	return `${candidate.assetType}:${candidate.assetId}`;
}
