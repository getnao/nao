import { Database, Folder, Home, Table } from 'lucide-react';
import {
	isSchemaMentionId,
	isStoryFolderMentionId,
	SHARED_WITH_ME_FOLDER_ID,
	toSchemaMentionId,
	toStoryFolderMentionId,
	toStoryReferenceMentionId,
} from '@nao/shared';
import { FOLDER_SYSTEM_TYPE } from '@nao/shared/types';
import type { MentionOption } from 'prompt-mentions';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { MentionOrigin, MentionOriginNode } from '@/components/mention-origin-preview';
import { DatabaseIcon } from '@/components/ui/database-icon';
import StoryIcon from '@/components/ui/story-icon';

type RouterOutputs = inferRouterOutputs<TrpcRouter>;
export type ReferenceableStory = RouterOutputs['story']['listReferenceable'][number];
export type StoryFolder = RouterOutputs['storyFolder']['listTree'][number];
export type StoryFolderItem = RouterOutputs['storyFolder']['listItems'][number];
export type DatabaseObject = RouterOutputs['project']['getDatabaseObjects'][number];

export type ReferenceMentionSources = {
	stories: ReferenceableStory[];
	mostViewedStories: ReferenceableStory[];
	folders: StoryFolder[];
	folderItems: StoryFolderItem[];
	databaseObjects: DatabaseObject[];
};

export type ReferenceMentionMenu = {
	/** A few quick picks, then the story folders and the tables to browse. */
	browseOptions: MentionOption[];
	/** Every mentionable story, folder, table and schema once, for the menu to search. */
	searchOptions: MentionOption[];
	/** Where each mentionable item lives, keyed by mention id. */
	origins: Map<string, MentionOrigin>;
};

export const STORIES_ROOT_ID = '__stories__';
export const TABLES_ROOT_ID = '__tables__';

export const QUICK_PICK_COUNT = 3;
const DIVIDER: MentionOption = { id: '__divider__', label: '', type: 'divider' };

const storyIcon = <StoryIcon className='size-4' />;
const tableIcon = <Table className='size-4' />;
const folderIcon = <Folder className='size-4' />;
const tablesRootIcon = <Database className='size-4' />;
const storiesRootIcon = <Home className='size-4' />;

export function buildReferenceMentionMenu(sources: ReferenceMentionSources): ReferenceMentionMenu {
	const origins = new Map<string, MentionOrigin>();
	const storyTree = buildStoryTree(sources, origins);
	const tableTree = buildTableTree(sources.databaseObjects, origins);
	return {
		browseOptions: buildBrowseOptions(sources, storyTree, tableTree),
		searchOptions: [
			...sources.stories.map(toStoryReferenceOption),
			...flattenTree(storyTree)
				.filter((option) => isStoryFolderMentionId(option.id))
				.map(asLeaf),
			...sources.databaseObjects.map(toTableOption),
			...flattenTree(tableTree)
				.filter((option) => isSchemaMentionId(option.id))
				.map(asLeaf),
		],
		origins,
	};
}

export function toStoryReferenceOption(story: Pick<ReferenceableStory, 'storyId' | 'title'>): MentionOption {
	return { id: toStoryReferenceMentionId(story.storyId), label: story.title, icon: storyIcon };
}

export function toStoryFolderReferenceOption(folder: Pick<StoryFolder, 'id' | 'name'>): MentionOption {
	return { id: toStoryFolderMentionId(folder.id), label: folder.name, icon: folderIcon };
}

/** Quick picks are the most viewed stories, topped up with the most trusted stories then tables. */
function buildBrowseOptions(
	{ stories, mostViewedStories, databaseObjects }: ReferenceMentionSources,
	storyTree: MentionOption[],
	tableTree: MentionOption[],
): MentionOption[] {
	const quickPickStories = uniqueBy([...mostViewedStories, ...stories], (story) => story.storyId);
	const quickPicks = [
		...quickPickStories.slice(0, QUICK_PICK_COUNT).map(toStoryReferenceOption),
		...databaseObjects.slice(0, QUICK_PICK_COUNT).map(toTableOption),
	].slice(0, QUICK_PICK_COUNT);
	const roots: MentionOption[] = [
		...(stories.length > 0
			? [{ id: STORIES_ROOT_ID, label: 'Stories', icon: storyIcon, children: storyTree }]
			: []),
		...(tableTree.length > 0
			? [{ id: TABLES_ROOT_ID, label: 'Tables', icon: tablesRootIcon, children: tableTree }]
			: []),
	];
	const divider = quickPicks.length > 0 && roots.length > 0 ? [DIVIDER] : [];
	return [...quickPicks, ...divider, ...roots];
}

/** Mirrors the stories page: system folders first, subfolders before stories. An empty folder has no submenu. */
function buildStoryTree(
	{ stories, folders, folderItems }: ReferenceMentionSources,
	origins: Map<string, MentionOrigin>,
): MentionOption[] {
	const knownFolderIds = new Set(folders.map((folder) => folder.id));
	const folderIdByStoryId = new Map(folderItems.map((item) => [item.storyId, item.folderId]));
	const storiesByFolderId = groupBy(stories, (story) => locateStory(story, folderIdByStoryId, knownFolderIds));
	const foldersByParentId = groupBy([...folders].sort(compareSystemFoldersFirst), (folder) => folder.parentId);
	const visitedFolderIds = new Set<string>();

	function buildLevel(folderId: string | null, path: MentionOrigin): MentionOption[] {
		const subfolders = (foldersByParentId.get(folderId) ?? []).flatMap((folder) => buildFolder(folder, path));
		const folderStories = (storiesByFolderId.get(folderId) ?? []).map((story) => {
			const option = toStoryReferenceOption(story);
			origins.set(option.id, [...path, { label: story.title, icon: storyIcon }]);
			return option;
		});
		return [...subfolders, ...folderStories];
	}

	function buildFolder(folder: StoryFolder, path: MentionOrigin): MentionOption[] {
		if (visitedFolderIds.has(folder.id)) {
			return [];
		}
		visitedFolderIds.add(folder.id);
		const folderPath = [...path, { label: folder.name, icon: folderIcon }];
		const children = buildLevel(folder.id, folderPath);
		const option = toStoryFolderReferenceOption(folder);
		origins.set(option.id, folderPath);
		return [children.length > 0 ? { ...option, children } : option];
	}

	return buildLevel(null, [{ label: 'Stories', icon: storiesRootIcon }]);
}

/** A story whose folder the user cannot see sits at the root. */
function locateStory(
	story: ReferenceableStory,
	folderIdByStoryId: Map<string, string>,
	knownFolderIds: Set<string>,
): string | null {
	const folderId = story.isSharedWithMe ? SHARED_WITH_ME_FOLDER_ID : folderIdByStoryId.get(story.storyId);
	return folderId && knownFolderIds.has(folderId) ? folderId : null;
}

function compareSystemFoldersFirst(a: StoryFolder, b: StoryFolder): number {
	return systemFolderRank(a) - systemFolderRank(b);
}

function systemFolderRank(folder: StoryFolder): number {
	return folder.systemType ? FOLDER_SYSTEM_TYPE.indexOf(folder.systemType) : FOLDER_SYSTEM_TYPE.length;
}

/** Databases, then schemas, then tables. A single database is skipped to keep the tree shallow. */
function buildTableTree(objects: DatabaseObject[], origins: Map<string, MentionOrigin>): MentionOption[] {
	const databases = [...groupBy(objects, (obj) => `${obj.type}.${obj.database}`).values()].map((tables) =>
		buildDatabase(tables, origins),
	);
	return databases.length === 1 ? (databases[0].children ?? []) : databases;
}

function buildDatabase(tables: DatabaseObject[], origins: Map<string, MentionOrigin>): MentionOption {
	const { type, database } = tables[0];
	const databaseNode = { label: database, icon: <DatabaseIcon dialect={type} className='size-4' /> };
	const schemas = [...groupBy(tables, (obj) => obj.schema).values()].map((schemaTables) =>
		buildSchema(schemaTables, databaseNode, origins),
	);
	return { id: `__database__.${type}.${database}`, label: database, icon: databaseNode.icon, children: schemas };
}

function buildSchema(
	tables: DatabaseObject[],
	databaseNode: MentionOriginNode,
	origins: Map<string, MentionOrigin>,
): MentionOption {
	const { database, schema } = tables[0];
	const schemaPath = [databaseNode, { label: schema, icon: folderIcon }];
	const option = { id: toSchemaMentionId(database, schema), label: schema, icon: folderIcon };
	origins.set(option.id, schemaPath);
	for (const table of tables) {
		origins.set(table.fqdn, [...schemaPath, { label: table.table, icon: tableIcon }]);
	}
	return { ...option, children: tables.map(toTableOption) };
}

function toTableOption(obj: DatabaseObject): MentionOption {
	return { id: obj.fqdn, label: obj.table, icon: tableIcon };
}

function asLeaf({ id, label, icon }: MentionOption): MentionOption {
	return { id, label, icon };
}

function flattenTree(options: MentionOption[]): MentionOption[] {
	return options.flatMap((option) => [option, ...flattenTree(option.children ?? [])]);
}

function uniqueBy<T, K>(items: T[], keyOf: (item: T) => K): T[] {
	const seenKeys = new Set<K>();
	return items.filter((item) => {
		const key = keyOf(item);
		if (seenKeys.has(key)) {
			return false;
		}
		seenKeys.add(key);
		return true;
	});
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>();
	for (const item of items) {
		const group = groups.get(keyOf(item));
		if (group) {
			group.push(item);
		} else {
			groups.set(keyOf(item), [item]);
		}
	}
	return groups;
}
