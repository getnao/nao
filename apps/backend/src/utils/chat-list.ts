import type { ChatFilterType, ChatGroup, ChatGroupBy, GroupedChatItem } from '@nao/shared/types';

const DAY_MS = 86_400_000;

const FILTER_PREDICATES: Record<ChatFilterType, (item: EnrichedChat) => boolean> = {
	all: () => true,
	mine: (item) => item.kind === 'own',
	starred: (item) => item.isStarred,
	shared: (item) => item.isSharedByMe,
	shared_with_me: (item) => item.kind === 'shared',
};

const GROUP_STRATEGIES: Record<ChatGroupBy, (items: EnrichedChat[]) => ChatGroup[]> = {
	star: groupByStar,
	date: groupByDate,
	project: groupByProject,
	ownership: groupByOwnership,
	none: (items) => [{ label: 'Chats', chats: toGroupedItems(items) }],
};

export interface EnrichedChat extends GroupedChatItem {
	projectId: string;
	projectName: string;
	isSharedByMe: boolean;
}

export function applyChatFilters(items: EnrichedChat[], filters: ChatFilterType[]): EnrichedChat[] {
	if (filters.includes('all')) {
		return items;
	}

	const predicates = filters.map((f) => FILTER_PREDICATES[f]).filter(Boolean);
	return items.filter((item) => predicates.some((pred) => pred(item)));
}

export function buildChatGroups(items: EnrichedChat[], groupBy: ChatGroupBy): ChatGroup[] {
	return (GROUP_STRATEGIES[groupBy] ?? GROUP_STRATEGIES.none)(items);
}

function groupByStar(items: EnrichedChat[]): ChatGroup[] {
	const starred = items.filter((i) => i.isStarred);
	const rest = items.filter((i) => !i.isStarred);
	const groups: ChatGroup[] = [];
	if (starred.length > 0) {
		groups.push({ label: 'Starred', chats: toGroupedItems(starred) });
	}
	groups.push({ label: 'Chats', chats: toGroupedItems(rest) });
	return groups;
}

function groupByDate(items: EnrichedChat[]): ChatGroup[] {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const yesterdayStart = todayStart - DAY_MS;
	const dayOfWeek = now.getDay();
	const weekStart = todayStart - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) * DAY_MS;

	const buckets: [string, (t: number) => boolean][] = [
		['Today', (t) => t >= todayStart],
		['Yesterday', (t) => t >= yesterdayStart],
		['This week', (t) => t >= weekStart],
		['Older', () => true],
	];

	const grouped = new Map<string, EnrichedChat[]>(buckets.map(([label]) => [label, []]));
	for (const item of items) {
		const label = buckets.find(([, pred]) => pred(item.updatedAt))![0];
		grouped.get(label)!.push(item);
	}

	return [...grouped.entries()]
		.filter(([, chats]) => chats.length > 0)
		.map(([label, chats]) => ({ label, chats: toGroupedItems(chats) }));
}

function groupByKey(items: EnrichedChat[], keyFn: (item: EnrichedChat) => string): ChatGroup[] {
	const groups = new Map<string, EnrichedChat[]>();
	for (const item of items) {
		const key = keyFn(item);
		if (!groups.has(key)) {
			groups.set(key, []);
		}
		groups.get(key)!.push(item);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([label, chats]) => ({ label, chats: toGroupedItems(chats) }));
}

function groupByProject(items: EnrichedChat[]) {
	return groupByKey(items, (i) => i.projectName);
}

function groupByOwnership(items: EnrichedChat[]) {
	return groupByKey(items, (i) => i.ownerName);
}

function toGroupedItems(items: EnrichedChat[]): GroupedChatItem[] {
	return items.map(
		({ id, title, isStarred, createdAt, updatedAt, kind, shareId, ownerName }): GroupedChatItem => ({
			id,
			title,
			isStarred,
			createdAt,
			updatedAt,
			kind,
			shareId,
			ownerName,
		}),
	);
}
