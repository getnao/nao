import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listOrgSeatCandidates: vi.fn(),
	listOrganizationSeatStates: vi.fn(),
	setSeatSelection: vi.fn(),
}));

vi.mock('../../src/queries/organization-seat.queries', () => mocks);

import { reserveSeat } from '../../src/services/organization-seat.service';

describe('organization seats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 26, 12, 0));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('reserves the bought seat ahead of members waiting for one, leaving seated members in place', async () => {
		mocks.listOrgSeatCandidates.mockResolvedValue([
			candidate('seated', new Date(2026, 0, 1)),
			candidate('waiting-1', new Date(2026, 0, 2)),
			candidate('waiting-2', new Date(2026, 0, 3)),
			candidate('unselected', null),
		]);
		mocks.listOrganizationSeatStates.mockResolvedValue([
			{ userId: 'seated', isReadOnly: false },
			{ userId: 'waiting-1', isReadOnly: true },
			{ userId: 'waiting-2', isReadOnly: true },
			{ userId: 'unselected', isReadOnly: true },
		]);

		await reserveSeat('org-1', 'new-member');

		const now = Date.now();
		expect(mocks.setSeatSelection.mock.calls).toEqual([
			['org-1', 'new-member', { selectedAt: new Date(now), selectionExplicit: true }],
			['org-1', 'waiting-1', { selectedAt: new Date(now + 1), selectionExplicit: true }],
			['org-1', 'waiting-2', { selectedAt: new Date(now + 2), selectionExplicit: true }],
		]);
	});
});

function candidate(id: string, selectedAt: Date | null) {
	return { id, membershipClass: 'org_member', selectedAt, selectionExplicit: selectedAt !== null };
}
