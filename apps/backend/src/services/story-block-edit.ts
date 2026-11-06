import {
	isHtmlStoryEntry,
	type StoryApp,
	type StoryKitBlockChange,
	type StoryKitBlockRef,
} from '@nao/shared/story-app';

import type { DBStoryVersion } from '../db/abstractSchema';
import { db, type DBTransaction } from '../db/db';
import * as storyQueries from '../queries/story.queries';
import type { StoryFileInput } from '../queries/story-file.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import { formatStoryFile } from '../utils/story-file-format';
import { isViewableStoryFile, normalizeStoryFilePath } from '../utils/story-file-path';
import { appendKitBlock, applyKitBlockChange, matchesKitBlock, parseKitSource } from '../utils/story-kit-jsx';
import { CustomStoryNotFoundError } from './custom-story';
import { queueCustomStoryThumbnail } from './custom-story-thumbnail';
import { buildStoryApp, resolveStoryEntry } from './story-app-build';

interface StoryBlockEditInput {
	chatId: string;
	authorId: string;
	storySlug: string;
	versionNumber: number;
	block: StoryKitBlockRef;
	change: StoryKitBlockChange;
}

interface StoryBlockAppendInput {
	chatId: string;
	authorId: string;
	storySlug: string;
	versionNumber: number;
	block: StoryKitBlockRef;
}

interface StoryVersionRestoreInput {
	chatId: string;
	authorId: string;
	storySlug: string;
	versionNumber: number;
	restoreVersionNumber: number;
}

interface StoryFilesSaveInput {
	chatId: string;
	authorId: string;
	storySlug: string;
	versionNumber: number;
	files: StoryFileInput[];
}

type StoryFilesSaveResult = { success: true; version: number } | { success: false; buildErrors: string[] };

type LatestVersionInput = Pick<StoryBlockEditInput, 'chatId' | 'storySlug' | 'versionNumber'>;

type EditorInput = Pick<StoryBlockEditInput, 'authorId' | 'versionNumber'>;

export class StoryBlockEditError extends Error {}

const SCRIPT_FILE = /\.(jsx?|tsx?)$/i;
const NEWER_VERSION_MESSAGE = 'The story has a newer version. Reload it and edit again.';
const AGENT_CHANGES_MESSAGE = 'The agent has unpublished changes to this story. Edit it once they are published.';
const ARCHIVED_MESSAGE = 'This story is archived. Unarchive it to edit it.';

export async function editCustomStoryBlock(input: StoryBlockEditInput): Promise<{ version: number }> {
	const story = await getEditableCustomStory(input.chatId, input.storySlug);
	const draft = await loadDraftMatchingLatestVersion(story.id, input);

	const target = locateBlock(draft, input.block);
	const content = await formatStoryFile(
		target.file.path,
		applyKitBlockChange(target.file.content, target.kitSource, target.element, input.change),
	);
	const files = draft.map((file) => (file.path === target.file.path ? { path: file.path, content } : file));

	const build = await buildStoryApp(files);
	if (!build.ok) {
		throw new StoryBlockEditError(`This edit would break the story: ${build.errors[0]}`);
	}

	const edit = { path: target.file.path, content };
	const version = await publishFileEdits(story.id, input, draft, [edit], build.app);
	return { version: version.version };
}

export async function appendCustomStoryBlock(input: StoryBlockAppendInput): Promise<{ version: number }> {
	const story = await getEditableCustomStory(input.chatId, input.storySlug);
	const draft = await loadDraftMatchingLatestVersion(story.id, input);
	const entry = findEntryFile(draft);
	const content = await formatStoryFile(entry.path, appendKitBlock(entry.path, entry.content, input.block));
	const files = draft.map((file) => (file.path === entry.path ? { path: file.path, content } : file));

	const build = await buildStoryApp(files);
	if (!build.ok) {
		throw new StoryBlockEditError(`Adding this block would break the story: ${build.errors[0]}`);
	}

	const edit = { path: entry.path, content };
	const version = await publishFileEdits(story.id, input, draft, [edit], build.app);
	return { version: version.version };
}

export async function saveCustomStoryFiles(input: StoryFilesSaveInput): Promise<StoryFilesSaveResult> {
	const story = await getEditableCustomStory(input.chatId, input.storySlug);
	const draft = await loadDraftMatchingLatestVersion(story.id, input);
	const edits = await normalizeFileEdits(draft, input.files);
	if (edits.size === 0) {
		throw new StoryBlockEditError('Nothing changed.');
	}
	const files = draft.map((file) => ({ path: file.path, content: edits.get(file.path) ?? file.content }));

	const build = await buildStoryApp(files);
	if (!build.ok) {
		return { success: false, buildErrors: build.errors };
	}

	const changedFiles = [...edits].map(([path, content]) => ({ path, content }));
	const version = await publishFileEdits(story.id, input, draft, changedFiles, build.app);
	return { success: true, version: version.version };
}

/** Restoring re-publishes an older version's files and bundle as the new latest version. */
export async function restoreCustomStoryVersion(input: StoryVersionRestoreInput): Promise<{ version: number }> {
	const story = await getEditableCustomStory(input.chatId, input.storySlug);
	const draft = await loadDraftMatchingLatestVersion(story.id, input);
	const restored = await storyQueries.getVersionByNumber(input.chatId, input.storySlug, input.restoreVersionNumber);
	if (!restored) {
		throw new CustomStoryNotFoundError();
	}
	const [files, bundle] = await Promise.all([
		storyFileQueries.listVersionFiles(restored.id),
		storyFileQueries.getVersionBundle(restored.id),
	]);
	const restoredApp = storyFileQueries.storyAppOfBundle(bundle);
	if (!restoredApp) {
		throw new StoryBlockEditError('This version did not build, so it cannot be restored.');
	}

	const version = await commitEdit(story.id, async (tx) => {
		if (!storyFileQueries.hasSameFiles(await storyFileQueries.listDraftFiles(story.id, tx), draft)) {
			throw new StoryBlockEditError(AGENT_CHANGES_MESSAGE);
		}
		await storyFileQueries.replaceDraftFiles(
			story.id,
			files.map((file) => ({ path: file.path, content: file.content })),
			tx,
		);
		const cut = await storyFileQueries.cutVersionFromDraft(
			{
				storyId: story.id,
				action: 'update',
				source: 'user',
				origin: 'editor',
				authorId: input.authorId,
				sourceChatId: null,
				versionNumber: input.versionNumber + 1,
			},
			tx,
		);
		await storyFileQueries.setVersionBundle(cut.version.id, restoredApp, tx);
		return cut.version;
	});
	return { version: version.version };
}

async function getEditableCustomStory(chatId: string, storySlug: string) {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	if (story.archivedAt) {
		throw new StoryBlockEditError(ARCHIVED_MESSAGE);
	}
	return story;
}

/** Writes the edited files into the draft, unless the agent changed it meanwhile, and publishes it with its build. */
function publishFileEdits(
	storyId: string,
	editor: EditorInput,
	draft: StoryFileInput[],
	changedFiles: StoryFileInput[],
	app: StoryApp,
): Promise<DBStoryVersion> {
	return commitEdit(storyId, async (tx) => {
		if (!storyFileQueries.hasSameFiles(await storyFileQueries.listDraftFiles(storyId, tx), draft)) {
			throw new StoryBlockEditError(AGENT_CHANGES_MESSAGE);
		}
		for (const file of changedFiles) {
			await storyFileQueries.writeDraftFile(storyId, file, tx);
		}
		const cut = await storyFileQueries.cutVersionFromDraft(
			{
				storyId,
				action: 'update',
				source: 'user',
				origin: 'editor',
				authorId: editor.authorId,
				sourceChatId: null,
				versionNumber: editor.versionNumber + 1,
			},
			tx,
		);
		await storyFileQueries.setVersionBundle(cut.version.id, app, tx);
		return cut.version;
	});
}

/** Each edit creates the version right after the one it started from, so a concurrent edit loses on the unique constraint. */
async function commitEdit(
	storyId: string,
	run: (tx: DBTransaction) => Promise<DBStoryVersion>,
): Promise<DBStoryVersion> {
	try {
		const version = await db.transaction(run);
		queueCustomStoryThumbnail(storyId, version.id);
		return version;
	} catch (error) {
		if (isVersionConflict(error)) {
			throw new StoryBlockEditError(NEWER_VERSION_MESSAGE);
		}
		throw error;
	}
}

function isVersionConflict(error: unknown): boolean {
	const { code, message } = error as { code?: unknown; message?: unknown };
	return (
		code === '23505' || (typeof message === 'string' && message.includes('UNIQUE constraint failed: story_version'))
	);
}

async function loadDraftMatchingLatestVersion(storyId: string, input: LatestVersionInput): Promise<StoryFileInput[]> {
	const latest = await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug);
	if (!latest || latest.version !== input.versionNumber) {
		throw new StoryBlockEditError(NEWER_VERSION_MESSAGE);
	}
	const [draft, published] = await Promise.all([
		storyFileQueries.listDraftFiles(storyId),
		storyFileQueries.listVersionFiles(latest.id),
	]);
	if (!storyFileQueries.hasSameFiles(draft, published)) {
		throw new StoryBlockEditError(AGENT_CHANGES_MESSAGE);
	}
	return draft.map((file) => ({ path: file.path, content: file.content }));
}

function findEntryFile(files: StoryFileInput[]): StoryFileInput {
	const entry = resolveStoryEntry(Object.fromEntries(files.map((file) => [file.path, file.content])));
	if (!entry.ok) {
		throw new StoryBlockEditError(entry.errors[0]);
	}
	if (isHtmlStoryEntry(entry.path)) {
		throw new StoryBlockEditError('Blocks cannot be added to an HTML story. Ask the agent to add it.');
	}
	return files.find((file) => file.path === entry.path)!;
}

function locateBlock(files: StoryFileInput[], block: StoryKitBlockRef) {
	const matches = files
		.filter((file) => SCRIPT_FILE.test(file.path))
		.flatMap((file) => {
			const kitSource = parseKitSource(file.path, file.content);
			if (!kitSource) {
				return [];
			}
			return kitSource.elements
				.filter((element) => matchesKitBlock(element, block))
				.map((element) => ({ file, kitSource, element }));
		});
	if (matches.length === 0) {
		throw new StoryBlockEditError('Could not locate the item in the current story version.');
	}
	if (matches.length > 1) {
		throw new StoryBlockEditError(
			'Could not uniquely identify the item because the same block appears more than once. Give it a distinct title first.',
		);
	}
	return matches[0];
}

async function normalizeFileEdits(draft: StoryFileInput[], files: StoryFileInput[]): Promise<Map<string, string>> {
	const current = new Map(draft.map((file) => [file.path, file.content]));
	const edits = new Map<string, string>();
	for (const file of files) {
		const path = normalizeStoryFilePath(file.path);
		if (!current.has(path) || !isViewableStoryFile(path)) {
			throw new StoryBlockEditError(`${path} is not a file of this story that can be edited.`);
		}
		if (Buffer.byteLength(file.content, 'utf8') > storyFileQueries.MAX_STORY_FILE_BYTES) {
			throw new StoryBlockEditError(
				`${path} is larger than the ${storyFileQueries.MAX_STORY_FILE_BYTES / 1024} KB limit.`,
			);
		}
		const content = await formatStoryFile(path, file.content);
		if (current.get(path) !== content) {
			edits.set(path, content);
		}
	}
	return edits;
}
