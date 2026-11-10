export interface UserSections<User> {
	projectUsers: User[];
	organizationUsers: User[];
}

/** Slices both sections as one continuous list, project users first, so sections can span page boundaries. */
export function paginateUserSections<User>(
	sections: UserSections<User>,
	pageIndex: number,
	pageSize: number,
): UserSections<User> {
	const start = pageIndex * pageSize;
	const end = start + pageSize;
	const projectUserCount = sections.projectUsers.length;
	return {
		projectUsers: sections.projectUsers.slice(start, end),
		organizationUsers: sections.organizationUsers.slice(
			Math.max(0, start - projectUserCount),
			Math.max(0, end - projectUserCount),
		),
	};
}

export function countUsers<User>(sections: UserSections<User>): number {
	return sections.projectUsers.length + sections.organizationUsers.length;
}
