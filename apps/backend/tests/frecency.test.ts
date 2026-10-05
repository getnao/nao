import { describe, expect, it } from 'vitest';

import { type FrecencyVisit, rankByFrecency, toLocalMoment } from '../src/services/frecency';

const TIMEZONE = 'Europe/Paris';
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Wednesday 2026-09-16 09:00 in Paris (UTC+2). */
const WEDNESDAY_MORNING = new Date('2026-09-16T07:00:00.000Z');
/** Wednesday 2026-09-16 18:00 in Paris. */
const WEDNESDAY_EVENING = new Date('2026-09-16T16:00:00.000Z');

function visit(assetId: string, viewedAt: Date, assetType: 'chat' | 'story' = 'story'): FrecencyVisit {
	return { assetType, assetId, shareId: null, viewedAt };
}

/** Visits of `assetId` at the same local hour on each of the previous `count` days. */
function dailyVisits(assetId: string, from: Date, count: number, assetType: 'chat' | 'story' = 'story') {
	return Array.from({ length: count }, (_, index) =>
		visit(assetId, new Date(from.getTime() - (index + 1) * DAY_MS), assetType),
	);
}

/** Visits of `assetId` at the same local hour on the five weekdays preceding a Wednesday. */
function weekdayVisits(assetId: string, from: Date) {
	return [1, 2, 5, 6, 7].map((daysAgo) => visit(assetId, new Date(from.getTime() - daysAgo * DAY_MS)));
}

describe('toLocalMoment', () => {
	it('converts to the requested timezone', () => {
		const moment = toLocalMoment(WEDNESDAY_MORNING, TIMEZONE);
		expect(moment.hour).toBe(9);
		expect(moment.weekday).toBe(3);
		expect(moment.dayOfMonth).toBe(16);
		expect(moment.label).toBe('Wednesday 9am');
	});

	it('falls back to UTC for an unknown timezone', () => {
		expect(toLocalMoment(WEDNESDAY_MORNING, 'Not/AZone').hour).toBe(7);
	});
});

describe('rankByFrecency', () => {
	it('returns nothing without visits', () => {
		expect(rankByFrecency([], WEDNESDAY_MORNING, TIMEZONE)).toEqual([]);
	});

	it('surfaces the morning habit in the morning and the evening habit in the evening', () => {
		const visits = [
			...dailyVisits('morning-report', WEDNESDAY_MORNING, 5),
			...dailyVisits('evening-chat', WEDNESDAY_EVENING, 5, 'chat'),
		];

		const morning = rankByFrecency(visits, WEDNESDAY_MORNING, TIMEZONE);
		expect(morning.map((c) => c.assetId)).toEqual(['morning-report', 'evening-chat']);

		const evening = rankByFrecency(visits, WEDNESDAY_EVENING, TIMEZONE);
		expect(evening.map((c) => c.assetId)).toEqual(['evening-chat', 'morning-report']);
	});

	it('prefers frequent and recent items over a single old visit', () => {
		const visits = [
			...dailyVisits('frequent', WEDNESDAY_MORNING, 4),
			visit('stale', new Date(WEDNESDAY_MORNING.getTime() - 40 * DAY_MS)),
		];

		const [first, second] = rankByFrecency(visits, WEDNESDAY_MORNING, TIMEZONE);
		expect(first.assetId).toBe('frequent');
		expect(second.assetId).toBe('stale');
		expect(first.score).toBeGreaterThan(second.score * 10);
	});

	it('explains a routine that matches the current time', () => {
		const [candidate] = rankByFrecency(weekdayVisits('report', WEDNESDAY_MORNING), WEDNESDAY_MORNING, TIMEZONE);

		expect(candidate.peakHour).toBe(9);
		expect(candidate.peakHourShare).toBe(1);
		expect(candidate.visitCount).toBe(5);
		expect(candidate.visitsLastWeek).toBe(5);
		expect(candidate.reason).toBe('You usually open this around now on weekdays');
	});

	it('explains a routine that happens at another time of day', () => {
		const [candidate] = rankByFrecency(weekdayVisits('report', WEDNESDAY_MORNING), WEDNESDAY_EVENING, TIMEZONE);
		expect(candidate.reason).toBe('You usually open this around 9am on weekdays');
	});

	it('does not claim a daily routine is happening now when it includes weekends', () => {
		const [candidate] = rankByFrecency(dailyVisits('report', WEDNESDAY_MORNING, 5), WEDNESDAY_MORNING, TIMEZONE);
		expect(candidate.reason).toBe('You usually open this around now');
	});

	it('names the weekday when a routine happens on the same day every week', () => {
		const mondays = [1, 2, 3, 4].map((weeks) =>
			visit('weekly', new Date(WEDNESDAY_MORNING.getTime() - (weeks * 7 + 2) * DAY_MS)),
		);
		const [candidate] = rankByFrecency(mondays, WEDNESDAY_MORNING, TIMEZONE);
		expect(candidate.reason).toBe('You usually open this around 9am on Mondays');
	});

	it('falls back to visit counts and recency when there is no routine', () => {
		const scattered = [
			visit('random', new Date(WEDNESDAY_MORNING.getTime() - 1 * DAY_MS - 5 * 60 * 60 * 1_000)),
			visit('random', new Date(WEDNESDAY_MORNING.getTime() - 2 * DAY_MS + 6 * 60 * 60 * 1_000)),
			visit('random', new Date(WEDNESDAY_MORNING.getTime() - 3 * DAY_MS - 10 * 60 * 60 * 1_000)),
		];
		const [threeThisWeek] = rankByFrecency(scattered, WEDNESDAY_MORNING, TIMEZONE);
		expect(threeThisWeek.reason).toBe('Opened 3 times this week');

		const [single] = rankByFrecency(
			[visit('once', new Date(WEDNESDAY_MORNING.getTime() - 3 * DAY_MS))],
			WEDNESDAY_MORNING,
			TIMEZONE,
		);
		expect(single.reason).toBe('Last opened 3 days ago');
	});

	it('keeps the share id of the most recent visit', () => {
		const visits: FrecencyVisit[] = [
			{
				assetType: 'chat',
				assetId: 'c1',
				shareId: 'old-share',
				viewedAt: new Date(WEDNESDAY_MORNING.getTime() - 2 * DAY_MS),
			},
			{
				assetType: 'chat',
				assetId: 'c1',
				shareId: 'new-share',
				viewedAt: new Date(WEDNESDAY_MORNING.getTime() - DAY_MS),
			},
		];
		const [candidate] = rankByFrecency(visits, WEDNESDAY_MORNING, TIMEZONE);
		expect(candidate.shareId).toBe('new-share');
		expect(candidate.assetType).toBe('chat');
	});

	it('keeps chats and stories with the same id apart', () => {
		const visits = [visit('same', WEDNESDAY_MORNING, 'chat'), visit('same', WEDNESDAY_MORNING, 'story')];
		expect(rankByFrecency(visits, WEDNESDAY_MORNING, TIMEZONE)).toHaveLength(2);
	});
});
