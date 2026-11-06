import { describe, expect, it } from 'vitest';

import {
	ALL_GROUPS_FILTER,
	filterProjectUsers,
	hasActiveProjectUserFilters,
	NO_CUSTOM_GROUP_FILTER,
} from './project-user-filters';

const users = [
	{ id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' },
	{ id: 'grace', name: 'Grace Hopper', email: 'grace@navy.mil' },
	{ id: 'linus', name: 'Linus', email: 'linus@example.com' },
];
const customGroupIds = ['analysts', 'finance'];
const membershipKeys = new Set([
	'all-users:ada',
	'all-users:grace',
	'all-users:linus',
	'analysts:ada',
	'finance:grace',
]);

describe('filterProjectUsers', () => {
	it('matches the search against names and emails case-insensitively', () => {
		expect(filter({ search: ' LOVELACE ' })).toEqual(['ada']);
		expect(filter({ search: 'navy' })).toEqual(['grace']);
		expect(filter({ search: 'example.com' })).toEqual(['ada', 'linus']);
	});

	it('filters by group membership or by the absence of any custom group', () => {
		expect(filter({ groupFilter: 'finance' })).toEqual(['grace']);
		expect(filter({ groupFilter: NO_CUSTOM_GROUP_FILTER })).toEqual(['linus']);
		expect(filter({ groupFilter: ALL_GROUPS_FILTER })).toEqual(['ada', 'grace', 'linus']);
	});

	it('combines the search with the group filter', () => {
		expect(filter({ search: 'example', groupFilter: 'analysts' })).toEqual(['ada']);
		expect(filter({ search: 'grace', groupFilter: 'analysts' })).toEqual([]);
	});
});

describe('hasActiveProjectUserFilters', () => {
	it('ignores whitespace-only searches and the default group filter', () => {
		expect(hasActiveProjectUserFilters({ search: '  ', groupFilter: ALL_GROUPS_FILTER })).toBe(false);
		expect(hasActiveProjectUserFilters({ search: 'ada', groupFilter: ALL_GROUPS_FILTER })).toBe(true);
		expect(hasActiveProjectUserFilters({ search: '', groupFilter: 'finance' })).toBe(true);
	});
});

function filter({ search = '', groupFilter = ALL_GROUPS_FILTER }: { search?: string; groupFilter?: string }) {
	return filterProjectUsers(users, { search, groupFilter }, customGroupIds, membershipKeys).map((user) => user.id);
}
