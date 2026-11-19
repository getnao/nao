import { describe, expect, it } from 'vitest';

import type { ShareCandidate, ShareGrant } from '@/lib/share-access';
import type { ShareDraft, ShareSavedState } from '@/lib/share-draft';
import type { FolderItem } from '@/lib/stories-page';
import {
	createShareDraft,
	fitDraftToFolder,
	isProjectOverride,
	isShareDraftChanged,
	isShareDraftEmpty,
	projectMemberRole,
	setGrantRole,
	setProjectMemberRole,
	setRoleForWholeProject,
	toggleGrant,
	toSavedGrants,
} from '@/lib/share-draft';

const ADA: ShareCandidate = { key: 'user:ada', kind: 'user', id: 'ada', name: 'Ada', detail: 'ada@example.com' };
const BOB: ShareCandidate = { key: 'user:bob', kind: 'user', id: 'bob', name: 'Bob', detail: 'bob@example.com' };
const ANALYSTS: ShareCandidate = {
	key: 'group:analysts',
	kind: 'group',
	id: 'analysts',
	name: 'Analysts',
	detail: '3 members',
};
const SALES: ShareCandidate = { key: 'group:sales', kind: 'group', id: 'sales', name: 'Sales', detail: '2 members' };

const NOT_SHARED: ShareSavedState = { isShared: false, visibility: 'specific', projectRole: 'viewer', grants: [] };

describe('share draft', () => {
	it('starts a new share on the whole project when allowed, else on specific people', () => {
		expect(createShareDraft(NOT_SHARED, true).visibility).toBe('project');
		expect(createShareDraft(NOT_SHARED, false).visibility).toBe('specific');
	});

	it('starts from what is saved for an existing share', () => {
		const saved = shared({ grants: [grant(ADA, 'editor')] });

		expect(createShareDraft(saved, true)).toEqual({
			visibility: 'specific',
			projectRole: 'viewer',
			grants: [grant(ADA, 'editor')],
		});
	});

	it('counts a draft as changed only when it differs from what is saved', () => {
		const saved = shared({ grants: [grant(ADA, 'viewer')] });
		const draft = createShareDraft(saved, true);

		expect(isShareDraftChanged(draft, saved)).toBe(false);
		expect(isShareDraftChanged(setGrantRole(draft, ADA, 'editor'), saved)).toBe(true);
		expect(isShareDraftChanged(createShareDraft(NOT_SHARED, true), NOT_SHARED)).toBe(true);
	});

	it('gives access as a viewer when a row is checked and takes it back when unchecked', () => {
		const draft = toggleGrant(createShareDraft(shared({}), true), ANALYSTS);

		expect(draft.grants).toEqual([grant(ANALYSTS, 'viewer')]);
		expect(toggleGrant(draft, ANALYSTS).grants).toEqual([]);
	});

	it('gives access with the default role picked for new people', () => {
		const draft = toggleGrant(createShareDraft(shared({}), true), ADA, 'editor');

		expect(draft.grants).toEqual([grant(ADA, 'editor')]);
	});

	it('gives access with the role picked on a row', () => {
		const draft = setGrantRole(createShareDraft(shared({}), true), BOB, 'editor');

		expect(draft.grants).toEqual([grant(BOB, 'editor')]);
	});

	it('keeps a per-person role in project mode only when it differs from everyone else', () => {
		const projectDraft = { visibility: 'project' as const, projectRole: 'viewer' as const, grants: [] };

		const withEditor = setProjectMemberRole(projectDraft, ADA, 'editor');
		expect(projectMemberRole(withEditor, ADA.key)).toBe('editor');
		expect(projectMemberRole(withEditor, BOB.key)).toBe('viewer');

		expect(setProjectMemberRole(withEditor, ADA, 'viewer').grants).toEqual([]);
	});

	it('treats people chosen as viewers in specific mode as plain members of a viewer project', () => {
		const draft = {
			visibility: 'project' as const,
			projectRole: 'viewer' as const,
			grants: [grant(ADA, 'viewer')],
		};

		expect(isProjectOverride(draft, ADA.key)).toBe(false);
		expect(isProjectOverride({ ...draft, grants: [grant(ADA, 'editor')] }, ADA.key)).toBe(true);
	});

	it('gives the whole project one role and drops the per-person ones', () => {
		const draft = setRoleForWholeProject(
			{ visibility: 'project', projectRole: 'viewer', grants: [grant(ADA, 'editor')] },
			'editor',
		);

		expect(draft).toMatchObject({ projectRole: 'editor', grants: [] });
	});

	it('treats a draft naming nobody, outside project mode, as sharing with no one', () => {
		expect(isShareDraftEmpty({ visibility: 'specific', projectRole: 'viewer', grants: [] })).toBe(true);
		expect(isShareDraftEmpty({ visibility: 'project', projectRole: 'viewer', grants: [] })).toBe(false);
		expect(
			isShareDraftEmpty({ visibility: 'specific', projectRole: 'viewer', grants: [grant(ADA, 'viewer')] }),
		).toBe(false);
	});

	it('saves only the per-person roles that differ from the project role', () => {
		const draft = {
			visibility: 'project' as const,
			projectRole: 'editor' as const,
			grants: [grant(ADA, 'viewer'), grant(BOB, 'editor'), grant(ANALYSTS, 'viewer')],
		};

		expect(toSavedGrants(draft)).toEqual([grant(ADA, 'viewer')]);
	});

	it.each<[string, Pick<FolderItem, 'visibility' | 'teamGroupIds'> | null, ShareDraft['visibility'], ShareGrant[]]>([
		['the root', null, 'project', [grant(ADA, 'editor')]],
		['an open folder', { visibility: 'public', teamGroupIds: [] }, 'project', [grant(ADA, 'editor')]],
		['a private folder', { visibility: 'private', teamGroupIds: [] }, 'specific', [grant(ADA, 'editor')]],
		[
			'a team folder',
			{ visibility: 'public', teamGroupIds: ['analysts'] },
			'specific',
			[grant(ADA, 'editor'), grant(ANALYSTS, 'viewer')],
		],
	])('opens the draft to the audience of %s', (_, folder, visibility, grants) => {
		const draft = {
			visibility: 'project' as const,
			projectRole: 'viewer' as const,
			grants: [grant(ADA, 'editor')],
		};

		expect(fitDraftToFolder(draft, folder, [ADA, BOB, ANALYSTS])).toEqual({ ...draft, visibility, grants });
	});

	it.each<[string, Pick<FolderItem, 'visibility' | 'teamGroupIds'> | null, ShareGrant[]]>([
		[
			'another team folder',
			{ visibility: 'public', teamGroupIds: ['sales'] },
			[grant(ADA, 'editor'), grant(SALES, 'viewer')],
		],
		['the root', null, [grant(ADA, 'editor')]],
		[
			'a private folder',
			{ visibility: 'private', teamGroupIds: [] },
			[grant(ADA, 'editor'), grant(ANALYSTS, 'viewer')],
		],
	])('replaces the groups of the team folder left for %s', (_, folder, grants) => {
		const draft = {
			visibility: 'specific' as const,
			projectRole: 'viewer' as const,
			grants: [grant(ADA, 'editor'), grant(ANALYSTS, 'viewer')],
		};
		const teamFolder = { visibility: 'public' as const, teamGroupIds: ['analysts'] };

		expect(fitDraftToFolder(draft, folder, [ADA, ANALYSTS, SALES], teamFolder).grants).toEqual(grants);
	});
});

function shared(state: Partial<ShareSavedState>): ShareSavedState {
	return { isShared: true, visibility: 'specific', projectRole: 'viewer', grants: [], ...state };
}

function grant(candidate: ShareCandidate, role: ShareGrant['role']): ShareGrant {
	return { ...candidate, role };
}
