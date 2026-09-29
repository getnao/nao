import type { StoryKitBlockChange, StoryKitBlockRef } from '@nao/shared/story-app';

import { db } from '../db/db';
import * as storyQueries from '../queries/story.queries';
import type { StoryFileInput } from '../queries/story-file.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import { isViewableStoryFile, normalizeStoryFilePath } from '../utils/story-file-path';
import { applyKitBlockChange, matchesKitBlock, parseKitSource } from '../utils/story-kit-jsx';
import { CustomStoryNotFoundError } from './custom-story';
import { buildStoryApp } from './story-app-build';

interface StoryBlockEditInput {
	chatId: string;
	storySlug: string;
	versionNumber: number;
	block: StoryKitBlockRef;
	change: StoryKitBlockChange;
}

interface StoryVersionRestoreInput {
	chatId: string;
	storySlug: string;
	versionNumber: number;
	restoreVersionNumber: number;
}

interface StoryFilesSaveInput {
	chatId: string;
	storySlug: string;
	versionNumber: number;
	files: StoryFileInput[];
}

type StoryFilesSaveResult = { success: true; version: number } | { success: false; buildErrors: string[] };

type LatestVersionInput = Pick<StoryBlockEditInput, 'chatId' | 'storySlug' | 'versionNumber'>;

export class StoryBlockEditError extends Error {}

const SCRIPT_FILE = /\.(jsx?|tsx?)$/i;
const AGENT_CHANGES_MESSAGE = 'The agent has unpublished changes to this story. Edit it once they are published.';

export async function editCustomStoryBlock(input: StoryBlockEditInput): Promise<{ version: number }> {
	const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	const draft = await loadDraftMatchingLatestVersion(story.id, input);

	const target = locateBlock(draft, input.block);
	const content = applyKitBlockChange(target.file.content, target.kitSource, target.element, input.change);
	const files = draft.map((file) => (file.path === target.file.path ? { path: file.path, content } : file));

	const build = await buildStoryApp(files);
	if (!build.ok) {
		throw new StoryBlockEditError(`This edit would break the story: ${build.errors[0]}`);
	}

	const version = await db.transaction(async (tx) => {
		if (!storyFileQueries.hasSameFiles(await storyFileQueries.listDraftFiles(story.id, tx), draft)) {
			throw new StoryBlockEditError(AGENT_CHANGES_MESSAGE);
		}
		await storyFileQueries.writeDraftFile(story.id, { path: target.file.path, content }, tx);
		const cut = await storyFileQueries.cutVersionFromDraft(
			{ storyId: story.id, action: 'update', source: 'user' },
			tx,
		);
		await storyFileQueries.setVersionBundle(cut.version.id, { bundle: build.bundle, bundleError: null }, tx);
		return cut.version;
	});
	return { version: version.version };
}

export async function saveCustomStoryFiles(input: StoryFilesSaveInput): Promise<StoryFilesSaveResult> {
	const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	const draft = await loadDraftMatchingLatestVersion(story.id, input);
	const edits = normalizeFileEdits(draft, input.files);
	if (edits.size === 0) {
		throw new StoryBlockEditError('Nothing changed.');
	}
	const files = draft.map((file) => ({ path: file.path, content: edits.get(file.path) ?? file.content }));

	const build = await buildStoryApp(files);
	if (!build.ok) {
		return { success: false, buildErrors: build.errors };
	}

	const version = await db.transaction(async (tx) => {
		if (!storyFileQueries.hasSameFiles(await storyFileQueries.listDraftFiles(story.id, tx), draft)) {
			throw new StoryBlockEditError(AGENT_CHANGES_MESSAGE);
		}
		for (const [path, content] of edits) {
			await storyFileQueries.writeDraftFile(story.id, { path, content }, tx);
		}
		const cut = await storyFileQueries.cutVersionFromDraft(
			{ storyId: story.id, action: 'update', source: 'user' },
			tx,
		);
		await storyFileQueries.setVersionBundle(cut.version.id, { bundle: build.bundle, bundleError: null }, tx);
		return cut.version;
	});
	return { success: true, version: version.version };
}

/** Restoring re-publishes an older version's files and bundle as the new latest version. */
export async function restoreCustomStoryVersion(input: StoryVersionRestoreInput): Promise<{ version: number }> {
	const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	const draft = await loadDraftMatchingLatestVersion(story.id, input);
	const restored = await storyQueries.getVersionByNumber(input.chatId, input.storySlug, input.restoreVersionNumber);
	if (!restored) {
		throw new CustomStoryNotFoundError();
	}
	const [files, bundle] = await Promise.all([
		storyFileQueries.listVersionFiles(restored.id),
		storyFileQueries.getVersionBundle(restored.id),
	]);
	const restoredBundle = bundle?.bundle;
	if (!restoredBundle) {
		throw new StoryBlockEditError('This version did not build, so it cannot be restored.');
	}

	const version = await db.transaction(async (tx) => {
		if (!storyFileQueries.hasSameFiles(await storyFileQueries.listDraftFiles(story.id, tx), draft)) {
			throw new StoryBlockEditError(AGENT_CHANGES_MESSAGE);
		}
		await storyFileQueries.replaceDraftFiles(
			story.id,
			files.map((file) => ({ path: file.path, content: file.content })),
			tx,
		);
		const cut = await storyFileQueries.cutVersionFromDraft(
			{ storyId: story.id, action: 'update', source: 'user' },
			tx,
		);
		await storyFileQueries.setVersionBundle(cut.version.id, { bundle: restoredBundle, bundleError: null }, tx);
		return cut.version;
	});
	return { version: version.version };
}

async function loadDraftMatchingLatestVersion(storyId: string, input: LatestVersionInput): Promise<StoryFileInput[]> {
	const latest = await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug);
	if (!latest || latest.version !== input.versionNumber) {
		throw new StoryBlockEditError('The story has a newer version. Reload it and edit again.');
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

function normalizeFileEdits(draft: StoryFileInput[], files: StoryFileInput[]): Map<string, string> {
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
		if (current.get(path) !== file.content) {
			edits.set(path, file.content);
		}
	}
	return edits;
}
