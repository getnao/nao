import type { DBStoryFolder } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { listShareableUserGroupsWithMembers } from './shareable-user-groups.service';

type FolderAccessPerson = {
	id: string;
	name: string;
	email: string;
	groupNames: string[];
	isAdmin: boolean;
};

type FolderAccess =
	| { kind: 'private' }
	| { kind: 'project'; memberCount: number }
	| { kind: 'groups'; people: FolderAccessPerson[] };

/** Who sees a folder and its stories, each with why: their groups or being admin. */
export async function getFolderAccess(folder: DBStoryFolder): Promise<FolderAccess> {
	if (folder.visibility === 'private') {
		return { kind: 'private' };
	}
	const [users, teamFolder] = await Promise.all([
		projectQueries.listUsersWithProjectAccess(folder.projectId),
		storyFolderQueries.findTeamFolderOf(folder.id),
	]);
	if (!teamFolder) {
		return { kind: 'project', memberCount: users.length };
	}

	const groups = await listShareableUserGroupsWithMembers(folder.projectId, teamFolder.groupIds);
	const people = users
		.map((user) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			groupNames: groups.filter((group) => group.memberIds.includes(user.id)).map((group) => group.name),
			isAdmin: user.role === 'admin',
		}))
		.filter((person) => person.groupNames.length > 0 || person.isAdmin)
		.sort((left, right) => left.name.localeCompare(right.name));
	return { kind: 'groups', people };
}
