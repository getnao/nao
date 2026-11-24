export const ALL_GROUPS_FILTER = 'all';
export const NO_CUSTOM_GROUP_FILTER = 'none';

export interface ProjectUserFilters {
	search: string;
	groupFilter: string;
}

interface FilterableUser {
	id: string;
	name: string;
	email: string;
}

export function filterProjectUsers<TUser extends FilterableUser>(
	users: TUser[],
	filters: ProjectUserFilters,
	customGroupIds: string[],
	membershipKeys: Set<string>,
): TUser[] {
	const query = filters.search.trim().toLowerCase();
	return users.filter(
		(user) =>
			matchesSearch(user, query) &&
			matchesGroupFilter(user.id, filters.groupFilter, customGroupIds, membershipKeys),
	);
}

export function hasActiveProjectUserFilters(filters: ProjectUserFilters): boolean {
	return filters.search.trim() !== '' || filters.groupFilter !== ALL_GROUPS_FILTER;
}

function matchesSearch(user: FilterableUser, query: string): boolean {
	return !query || user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
}

function matchesGroupFilter(
	userId: string,
	groupFilter: string,
	customGroupIds: string[],
	membershipKeys: Set<string>,
): boolean {
	if (groupFilter === ALL_GROUPS_FILTER) {
		return true;
	}
	if (groupFilter === NO_CUSTOM_GROUP_FILTER) {
		return !customGroupIds.some((groupId) => membershipKeys.has(`${groupId}:${userId}`));
	}
	return membershipKeys.has(`${groupFilter}:${userId}`);
}
