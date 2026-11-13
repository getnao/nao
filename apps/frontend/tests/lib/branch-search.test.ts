import { describe, expect, it } from 'vitest';
import type { RepoBranch } from '@nao/shared/types';

import { orderBranches, searchBranches } from '@/lib/branch-search';

const BRANCHES = [
	branch('main', { name: 'Bob Stone', login: 'bob' }),
	branch('alice/net-revenue', { name: 'Alice Martin', login: 'alice' }, true),
	branch('fix/orders', { name: 'Alice Martin', login: null }),
	branch('stale', null),
];

describe('searchBranches', () => {
	it.each([
		['every branch for an empty search', '', false, ['main', 'alice/net-revenue', 'fix/orders', 'stale']],
		['a branch name', 'REVENUE', false, ['alice/net-revenue']],
		['the author name or login', 'martin', false, ['alice/net-revenue', 'fix/orders']],
		['the author only after @', '@alice', false, ['alice/net-revenue', 'fix/orders']],
		['every word, in the name or the author', 'orders alice', false, ['fix/orders']],
		['the branches of the user', '', true, ['alice/net-revenue']],
		['the branches of the user matching the search', 'orders', true, []],
	])('keeps %s', (_case, search, isMineOnly, expected) => {
		expect(searchBranches(BRANCHES, search, isMineOnly).map((match) => match.name)).toEqual(expected);
	});
});

describe('orderBranches', () => {
	it('puts the pinned branch first, then the selected one, keeping the others in order', () => {
		expect(orderBranches(BRANCHES, 'main', 'fix/orders').map((match) => match.name)).toEqual([
			'main',
			'fix/orders',
			'alice/net-revenue',
			'stale',
		]);
	});
});

function branch(name: string, author: RepoBranch['author'], isMine = false): RepoBranch {
	return { name, commit: `${name}-sha`, author, committedAt: null, isMine };
}
