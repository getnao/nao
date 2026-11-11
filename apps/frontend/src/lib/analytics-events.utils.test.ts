import { describe, expect, it } from 'vitest';

import {
	getBadge,
	getFeedbackExplanation,
	groupRowsByActor,
	isCurrentFeedbackPositive,
} from './analytics-events.utils';
import type { EventRow } from './analytics-events.utils';

describe('story feedback analytics', () => {
	it('labels feedback events by vote and exposes the message', () => {
		const metadata = { type: 'feedback', vote: 'down', explanation: 'Wrong totals' } as const;

		expect(getBadge(metadata)).toBe('negative');
		expect(getFeedbackExplanation(metadata)).toBe('Wrong totals');
		expect(getFeedbackExplanation({ type: 'favorite', favorited: true })).toBeNull();
	});

	it('uses the latest vote of each person as their current feedback', () => {
		const rows: EventRow[] = [
			{ actor: 'Ada', actorKey: 'Ada', createdAt: new Date('2026-10-01'), badge: 'negative' },
			{ actor: 'Ada', actorKey: 'Ada', createdAt: new Date('2026-10-02'), badge: 'positive' },
		];

		const [group] = groupRowsByActor(rows);

		expect(isCurrentFeedbackPositive(group)).toBe(true);
	});
});
