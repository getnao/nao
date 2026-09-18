import type { AnalyticsAssetType } from '@nao/shared/types';

export interface FrecencyVisit {
	assetType: AnalyticsAssetType;
	assetId: string;
	shareId: string | null;
	viewedAt: Date;
}

export interface LocalMoment {
	hour: number;
	weekday: number;
	dayOfMonth: number;
	label: string;
}

export interface FrecencyCandidate {
	assetType: AnalyticsAssetType;
	assetId: string;
	shareId: string | null;
	score: number;
	visitCount: number;
	visitsLastWeek: number;
	lastVisitedDaysAgo: number;
	peakHour: number | null;
	peakHourShare: number;
	weekdayHistogram: number[];
	reason: string;
}

/** Days after which a visit only contributes a residual weight. */
const RECENCY_HALF_LIFE_DAYS = 10;
const RECENCY_FLOOR = 0.05;
/** Standard deviation, in hours, of the time-of-day affinity bell curve. */
const HOUR_AFFINITY_SIGMA = 2;
/** How much a visit is boosted when it matches the current time-of-day and weekday pattern. */
const CONTEXT_BOOST = 2;
const ROUTINE_MIN_VISITS = 3;
const ROUTINE_MIN_SHARE = 0.6;
const ROUTINE_WINDOW_HOURS = 1.5;
const DAY_MS = 24 * 60 * 60 * 1_000;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Ranks assets by a context-aware frecency: recent and frequent visits weigh more, and visits that
 * happened around the same time of day and same kind of day as `now` are boosted so habits surface.
 */
export function rankByFrecency(visits: FrecencyVisit[], now: Date, timezone: string): FrecencyCandidate[] {
	const current = toLocalMoment(now, timezone);
	const grouped = groupVisitsByAsset(visits);
	const candidates: FrecencyCandidate[] = [];

	for (const assetVisits of grouped.values()) {
		const candidate = scoreAsset(assetVisits, now, current, timezone);
		if (candidate) {
			candidates.push(candidate);
		}
	}

	return candidates.sort((a, b) => b.score - a.score);
}

export function toLocalMoment(date: Date, timezone: string): LocalMoment {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: safeTimezone(timezone),
		hour: 'numeric',
		minute: 'numeric',
		hourCycle: 'h23',
		weekday: 'long',
		day: 'numeric',
	});
	const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	const hour = Number(parts.get('hour') ?? 0) % 24;
	const minute = Number(parts.get('minute') ?? 0);
	const weekdayName = parts.get('weekday') ?? 'Monday';
	const weekday = Math.max(0, WEEKDAY_NAMES.indexOf(weekdayName));
	const dayOfMonth = Number(parts.get('day') ?? 1);
	return {
		hour: hour + minute / 60,
		weekday,
		dayOfMonth,
		label: `${weekdayName} ${formatHour(hour)}`,
	};
}

export function describeHour(hour: number): string {
	return formatHour(Math.round(hour) % 24);
}

function safeTimezone(timezone: string): string {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: timezone });
		return timezone;
	} catch {
		return 'UTC';
	}
}

function groupVisitsByAsset(visits: FrecencyVisit[]): Map<string, FrecencyVisit[]> {
	const grouped = new Map<string, FrecencyVisit[]>();
	for (const visit of visits) {
		const key = `${visit.assetType}:${visit.assetId}`;
		const bucket = grouped.get(key);
		if (bucket) {
			bucket.push(visit);
		} else {
			grouped.set(key, [visit]);
		}
	}
	return grouped;
}

function scoreAsset(
	visits: FrecencyVisit[],
	now: Date,
	current: LocalMoment,
	timezone: string,
): FrecencyCandidate | null {
	if (visits.length === 0) {
		return null;
	}

	let score = 0;
	let visitsLastWeek = 0;
	let mostRecentMs = 0;
	let shareId: string | null = null;
	const localHours: number[] = [];
	const weekdayHistogram = new Array<number>(7).fill(0);

	for (const visit of visits) {
		const ageDays = Math.max(0, (now.getTime() - visit.viewedAt.getTime()) / DAY_MS);
		const local = toLocalMoment(visit.viewedAt, timezone);
		const affinity = hourAffinity(local.hour, current.hour) * weekdayAffinity(local.weekday, current.weekday);
		score += recencyWeight(ageDays) * (1 + CONTEXT_BOOST * affinity);

		if (ageDays <= 7) {
			visitsLastWeek += 1;
		}
		if (visit.viewedAt.getTime() > mostRecentMs) {
			mostRecentMs = visit.viewedAt.getTime();
			shareId = visit.shareId;
		}
		localHours.push(local.hour);
		weekdayHistogram[local.weekday] += 1;
	}

	const routine = detectRoutine(localHours);
	const lastVisitedDaysAgo = (now.getTime() - mostRecentMs) / DAY_MS;
	const first = visits[0];

	return {
		assetType: first.assetType,
		assetId: first.assetId,
		shareId,
		score: Math.round(score * 1000) / 1000,
		visitCount: visits.length,
		visitsLastWeek,
		lastVisitedDaysAgo: Math.round(lastVisitedDaysAgo * 10) / 10,
		peakHour: routine.peakHour,
		peakHourShare: routine.share,
		weekdayHistogram,
		reason: buildReason({
			routine,
			current,
			weekdayHistogram,
			visitCount: visits.length,
			visitsLastWeek,
			lastVisitedDaysAgo,
		}),
	};
}

function recencyWeight(ageDays: number): number {
	return Math.max(RECENCY_FLOOR, Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS));
}

function hourAffinity(visitHour: number, currentHour: number): number {
	const distance = circularHourDistance(visitHour, currentHour);
	return Math.exp(-Math.pow(distance / HOUR_AFFINITY_SIGMA, 2));
}

function weekdayAffinity(visitWeekday: number, currentWeekday: number): number {
	if (visitWeekday === currentWeekday) {
		return 1;
	}
	return isWeekend(visitWeekday) === isWeekend(currentWeekday) ? 0.6 : 0.3;
}

function circularHourDistance(a: number, b: number): number {
	const diff = Math.abs(a - b) % 24;
	return Math.min(diff, 24 - diff);
}

function isWeekend(weekday: number): boolean {
	return weekday === 0 || weekday === 6;
}

interface Routine {
	peakHour: number | null;
	share: number;
	isRoutine: boolean;
}

/** Finds the hour of day around which most visits cluster and whether that cluster is strong enough to call a habit. */
function detectRoutine(localHours: number[]): Routine {
	if (localHours.length === 0) {
		return { peakHour: null, share: 0, isRoutine: false };
	}

	let bestHour = 0;
	let bestCount = -1;
	let bestSpread = Number.POSITIVE_INFINITY;
	for (let hour = 0; hour < 24; hour++) {
		const distances = localHours
			.map((h) => circularHourDistance(h, hour))
			.filter((distance) => distance <= ROUTINE_WINDOW_HOURS);
		const spread = distances.reduce((sum, distance) => sum + distance, 0);
		if (distances.length > bestCount || (distances.length === bestCount && spread < bestSpread)) {
			bestCount = distances.length;
			bestSpread = spread;
			bestHour = hour;
		}
	}

	const share = bestCount / localHours.length;
	const isRoutine = localHours.length >= ROUTINE_MIN_VISITS && share >= ROUTINE_MIN_SHARE;
	return { peakHour: bestHour, share, isRoutine };
}

function buildReason({
	routine,
	current,
	weekdayHistogram,
	visitCount,
	visitsLastWeek,
	lastVisitedDaysAgo,
}: {
	routine: Routine;
	current: LocalMoment;
	weekdayHistogram: number[];
	visitCount: number;
	visitsLastWeek: number;
	lastVisitedDaysAgo: number;
}): string {
	if (routine.isRoutine && routine.peakHour !== null) {
		const days = describeDays(weekdayHistogram, visitCount);
		const hourMatches = circularHourDistance(routine.peakHour, current.hour) <= ROUTINE_WINDOW_HOURS;
		const dayMatches = days === null || days.weekdays.has(current.weekday);
		const suffix = days ? ` on ${days.label}` : '';
		if (hourMatches && dayMatches) {
			return `You usually open this around now${suffix}`;
		}
		return `You usually open this around ${formatHour(routine.peakHour)}${suffix}`;
	}
	if (visitsLastWeek >= 3) {
		return `Opened ${visitsLastWeek} times this week`;
	}
	if (visitCount >= 3) {
		return `Opened ${visitCount} times recently`;
	}
	return `Last opened ${describeDaysAgo(lastVisitedDaysAgo)}`;
}

interface DayPattern {
	label: string;
	weekdays: Set<number>;
}

function describeDays(weekdayHistogram: number[], visitCount: number): DayPattern | null {
	if (visitCount === 0) {
		return null;
	}
	const weekendVisits = weekdayHistogram[0] + weekdayHistogram[6];
	const weekdayVisits = visitCount - weekendVisits;
	const dominant = weekdayHistogram.reduce(
		(best, count, weekday) => (count > best.count ? { weekday, count } : best),
		{ weekday: -1, count: 0 },
	);
	if (dominant.count / visitCount >= 0.7 && visitCount >= 3) {
		return { label: `${WEEKDAY_NAMES[dominant.weekday]}s`, weekdays: new Set([dominant.weekday]) };
	}
	if (weekdayVisits / visitCount >= 0.85) {
		return { label: 'weekdays', weekdays: new Set([1, 2, 3, 4, 5]) };
	}
	if (weekendVisits / visitCount >= 0.85) {
		return { label: 'weekends', weekdays: new Set([0, 6]) };
	}
	return null;
}

function describeDaysAgo(days: number): string {
	if (days < 1) {
		return 'today';
	}
	if (days < 2) {
		return 'yesterday';
	}
	if (days < 7) {
		return `${Math.floor(days)} days ago`;
	}
	const weeks = Math.floor(days / 7);
	return weeks === 1 ? 'last week' : `${weeks} weeks ago`;
}

function formatHour(hour: number): string {
	const normalized = ((hour % 24) + 24) % 24;
	const suffix = normalized < 12 ? 'am' : 'pm';
	const twelveHour = normalized % 12 === 0 ? 12 : normalized % 12;
	return `${twelveHour}${suffix}`;
}
