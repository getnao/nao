import { describe, expect, it } from 'vitest';
import { SHARED_WITH_ME_FOLDER_ID } from '@nao/shared';
import type { MentionOption } from 'prompt-mentions';
import type { ReferenceMentionSources, ReferenceableStory, StoryFolder } from '@/lib/reference-mention-menu';
import { buildReferenceMentionMenu, STORIES_ROOT_ID, TABLES_ROOT_ID } from '@/lib/reference-mention-menu';

describe('buildReferenceMentionMenu', () => {
	it('lists quick picks, then the Stories and Tables roots', () => {
		const { browseOptions } = buildReferenceMentionMenu(sources());

		expect(browseOptions.map((option) => option.id)).toEqual([
			'story:pinned',
			'story:nested',
			'story:root',
			'__divider__',
			STORIES_ROOT_ID,
			TABLES_ROOT_ID,
		]);
	});

	it('leads the quick picks with the most viewed stories of the week', () => {
		const { browseOptions } = buildReferenceMentionMenu({
			...sources(),
			mostViewedStories: [story('root', 'Root'), story('popular', 'Popular')],
		});

		expect(browseOptions.slice(0, 3).map((option) => option.id)).toEqual([
			'story:root',
			'story:popular',
			'story:pinned',
		]);
	});

	it('nests stories in their folders, system folders first, and keeps empty folders without a submenu', () => {
		const storiesRoot = rootOf(buildReferenceMentionMenu(sources()), STORIES_ROOT_ID);

		expect(tree(storiesRoot.children)).toEqual([
			{ id: 'story-folder:private', children: [{ id: 'story:pinned' }] },
			{ id: 'story-folder:finance', children: [{ id: 'story-folder:kpis', children: [{ id: 'story:nested' }] }] },
			{ id: 'story-folder:marketing' },
			{ id: 'story:root' },
		]);
	});

	it('files a shared story in its folder when the user sees it, in "Shared with me" otherwise', () => {
		const base = sources();
		const storiesRoot = rootOf(
			buildReferenceMentionMenu({
				...base,
				stories: [
					{ ...story('team', 'Team'), isSharedWithMe: true },
					{ ...story('hidden', 'Hidden'), isSharedWithMe: true },
				],
				folders: [
					folder(SHARED_WITH_ME_FOLDER_ID, 'Shared with me', null, { systemType: 'shared_with_me' }),
					folder('sales', 'Sales'),
				],
				folderItems: [
					{ storyId: 'team', folderId: 'sales' },
					{ storyId: 'hidden', folderId: 'someone-else-private' },
				],
			}),
			STORIES_ROOT_ID,
		);

		expect(tree(storiesRoot.children)).toEqual([
			{ id: `story-folder:${SHARED_WITH_ME_FOLDER_ID}`, children: [{ id: 'story:hidden' }] },
			{ id: 'story-folder:sales', children: [{ id: 'story:team' }] },
		]);
	});

	it('searches a flat list of every mentionable item, once', () => {
		const { searchOptions } = buildReferenceMentionMenu(sources());

		expect(tree(searchOptions)).toEqual([
			{ id: 'story:pinned' },
			{ id: 'story:nested' },
			{ id: 'story:root' },
			{ id: 'story-folder:private' },
			{ id: 'story-folder:finance' },
			{ id: 'story-folder:kpis' },
			{ id: 'story-folder:marketing' },
			{ id: 'warehouse.public.orders' },
			{ id: 'warehouse.public.customers' },
			{ id: 'schema:warehouse.public' },
		]);
	});
});

type TreeNode = { id: string; children?: TreeNode[] };

function tree(options: MentionOption[] = []): TreeNode[] {
	return options.map((option) =>
		option.children ? { id: option.id, children: tree(option.children) } : { id: option.id },
	);
}

function rootOf(menu: ReturnType<typeof buildReferenceMentionMenu>, rootId: string): MentionOption {
	const root = menu.browseOptions.find((option) => option.id === rootId);
	if (!root) {
		throw new Error(`No ${rootId} root`);
	}
	return root;
}

function sources(): ReferenceMentionSources {
	return {
		stories: [story('pinned', 'Pinned'), story('nested', 'Nested'), story('root', 'Root')],
		mostViewedStories: [],
		folders: [
			folder('finance', 'Finance'),
			folder('kpis', 'KPIs', 'finance'),
			folder('marketing', 'Marketing'),
			folder('private', 'My private folder', null, { visibility: 'private', systemType: 'private_folder' }),
		],
		folderItems: [
			{ storyId: 'pinned', folderId: 'private' },
			{ storyId: 'nested', folderId: 'kpis' },
		],
		databaseObjects: [table('orders'), table('customers')],
	};
}

function story(storyId: string, title: string): ReferenceableStory {
	return {
		storyId,
		title,
		chatId: null,
		format: 'classic',
		authorName: 'Owner',
		isPinned: false,
		isCertified: false,
		isSharedWithMe: false,
	};
}

function folder(
	id: string,
	name: string,
	parentId: string | null = null,
	overrides: Partial<Pick<StoryFolder, 'visibility' | 'systemType'>> = {},
): StoryFolder {
	return {
		id,
		name,
		parentId,
		ownerId: 'owner',
		projectId: 'project',
		visibility: 'public',
		systemType: null,
		archivedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		storyCount: 0,
		...overrides,
	} as StoryFolder;
}

function table(name: string) {
	return { type: 'duckdb', database: 'warehouse', schema: 'public', table: name, fqdn: `warehouse.public.${name}` };
}
