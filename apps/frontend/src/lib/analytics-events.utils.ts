import type { AnalyticsEventMetadata } from '@nao/shared/types';

export interface AnalyticsEventEntry {
	event: {
		type: string;
		createdAt: Date | string | number;
		metadata: AnalyticsEventMetadata | null | undefined;
	};
	actorName: string | null;
}

export interface EventRow {
	actor: string | null;
	actorKey: string;
	createdAt: Date;
	badge?: string;
	versionNumber?: number | null;
	title?: string | null;
}

export interface ActorGroup<TItem> {
	actorKey: string;
	actorName: string | null;
	lastAt: number;
	items: TItem[];
}

export interface ViewSession {
	timestamp: Date;
	durationMs: number | null;
	versionNumber?: number | null;
}

export type Viewer = ActorGroup<ViewSession> & { totalDurationMs: number };

export function getVersionNumber(metadata: AnalyticsEventMetadata | null | undefined): number | null {
	if (!metadata) {
		return null;
	}
	switch (metadata.type) {
		case 'page_view':
		case 'download':
		case 'fork':
		case 'view_duration':
			return metadata.versionNumber ?? null;
		default:
			return null;
	}
}

export function getDownloadTitle(metadata: AnalyticsEventMetadata | null | undefined): string | null {
	return metadata?.type === 'download' ? (metadata.title ?? null) : null;
}

export function getBadge(metadata: AnalyticsEventMetadata | null | undefined): string | undefined {
	if (!metadata) {
		return undefined;
	}
	switch (metadata.type) {
		case 'download':
			return metadata.format;
		case 'refresh':
			return metadata.trigger;
		case 'fork':
			return metadata.scope;
		case 'favorite':
			return metadata.favorited ? 'added' : 'removed';
		default:
			return undefined;
	}
}

function matchesQuery(haystacks: Array<string | null | undefined>, query: string): boolean {
	if (!query) {
		return true;
	}
	return haystacks.some((value) => value != null && value.toLowerCase().includes(query));
}

export function filterRows<T>(
	showAllHaystacks: Array<string | null | undefined>,
	items: T[],
	rowHaystacks: (item: T) => Array<string | null | undefined>,
	query: string,
): T[] {
	if (!query) {
		return items;
	}
	if (matchesQuery(showAllHaystacks, query)) {
		return items;
	}
	return items.filter((item) => matchesQuery(rowHaystacks(item), query));
}

function groupByActor<T>(
	rows: T[],
	getActorName: (row: T) => string | null,
	getTime: (row: T) => number,
): ActorGroup<T>[] {
	const map = new Map<string, ActorGroup<T>>();

	for (const row of rows) {
		const actorName = getActorName(row);
		const actorKey = actorName ?? 'anonymous';
		if (!map.has(actorKey)) {
			map.set(actorKey, { actorKey, actorName, lastAt: 0, items: [] });
		}
		const group = map.get(actorKey)!;
		group.items.push(row);
		group.lastAt = Math.max(group.lastAt, getTime(row));
	}

	return Array.from(map.values())
		.map((g) => ({ ...g, items: g.items.slice().sort((a, b) => getTime(b) - getTime(a)) }))
		.sort((a, b) => b.lastAt - a.lastAt);
}

export function groupRowsByActor(rows: EventRow[]): ActorGroup<EventRow>[] {
	return groupByActor(
		rows,
		(row) => row.actor,
		(row) => row.createdAt.getTime(),
	);
}

const SESSION_GAP_MS = 60 * 60 * 1_000; // 1 hour

function mergeSegmentsIntoSessions(segments: ViewSession[]): ViewSession[] {
	const sorted = segments.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	const sessions: ViewSession[] = [];
	let current: { start: Date; end: number; totalMs: number; versionNumber: number | null } | null = null;

	for (const segment of sorted) {
		const start = segment.timestamp.getTime();
		const end = start + (segment.durationMs ?? 0);

		if (current && start - current.end < SESSION_GAP_MS) {
			current.end = Math.max(current.end, end);
			current.totalMs += segment.durationMs ?? 0;
			if (segment.versionNumber != null) {
				current.versionNumber = segment.versionNumber;
			}
			continue;
		}

		if (current) {
			sessions.push({
				timestamp: current.start,
				durationMs: current.totalMs,
				versionNumber: current.versionNumber,
			});
		}
		current = {
			start: segment.timestamp,
			end,
			totalMs: segment.durationMs ?? 0,
			versionNumber: segment.versionNumber ?? null,
		};
	}

	if (current) {
		sessions.push({ timestamp: current.start, durationMs: current.totalMs, versionNumber: current.versionNumber });
	}

	return sessions;
}

export function buildViewers(events: AnalyticsEventEntry[]): Viewer[] {
	const relevant = events.filter((r) => r.event.type === 'page_view' || r.event.type === 'view_duration');
	const groups = groupByActor(
		relevant,
		(r) => r.actorName,
		(r) => new Date(r.event.createdAt).getTime(),
	);

	return groups.map((group) => {
		const segments: ViewSession[] = [];
		const views: ViewSession[] = [];
		let totalDurationMs = 0;

		for (const r of group.items) {
			if (r.event.type === 'page_view') {
				views.push({
					timestamp: new Date(r.event.createdAt),
					durationMs: null,
					versionNumber: getVersionNumber(r.event.metadata),
				});
			} else if (r.event.metadata?.type === 'view_duration') {
				totalDurationMs += r.event.metadata.durationMs;
				segments.push({
					timestamp: new Date(r.event.metadata.startedAt),
					durationMs: r.event.metadata.durationMs,
					versionNumber: r.event.metadata.versionNumber ?? null,
				});
			}
		}

		const sessions = mergeSegmentsIntoSessions(segments);
		const items = (sessions.length > 0 ? sessions : views)
			.slice()
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

		return { actorKey: group.actorKey, actorName: group.actorName, lastAt: group.lastAt, items, totalDurationMs };
	});
}

export function isCurrentlyFavorited(group: ActorGroup<EventRow>): boolean {
	return group.items[0]?.badge === 'added';
}

export function countActiveFavorites(rows: EventRow[]): number {
	return groupRowsByActor(rows).filter(isCurrentlyFavorited).length;
}

export function formatDate(date: Date): string {
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (minutes < 1) {
		return 'just now';
	}
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	if (hours < 24) {
		return `${hours}h ago`;
	}
	if (days < 7) {
		return `${days}d ago`;
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	if (minutes === 0) {
		return `${seconds}s`;
	}
	if (seconds === 0) {
		return `${minutes}m`;
	}
	return `${minutes}m ${seconds}s`;
}
