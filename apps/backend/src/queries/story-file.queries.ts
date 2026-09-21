import { createHash } from 'node:crypto';

import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';

import s, {
	type DBStoryBundle,
	type DBStoryDraftFile,
	type DBStoryFile,
	type DBStoryVersion,
} from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import { normalizeStoryFilePath } from '../utils/story-file-path';

export interface StoryFileInput {
	path: string;
	content: string;
}

export type StoryFileWithContent = DBStoryFile & { content: string };

export const MAX_STORY_FILE_BYTES = 512 * 1024;
export const MAX_STORY_FILES = 60;

export class StoryFileLimitError extends Error {}

export function listDraftFiles(storyId: string, executor: DBExecutor = db): Promise<DBStoryDraftFile[]> {
	return executor
		.select()
		.from(s.storyDraftFile)
		.where(eq(s.storyDraftFile.storyId, storyId))
		.orderBy(asc(s.storyDraftFile.path))
		.execute();
}

export async function getDraftFile(
	storyId: string,
	path: string,
	executor: DBExecutor = db,
): Promise<DBStoryDraftFile | null> {
	const [row] = await executor
		.select()
		.from(s.storyDraftFile)
		.where(and(eq(s.storyDraftFile.storyId, storyId), eq(s.storyDraftFile.path, normalizeStoryFilePath(path))))
		.execute();
	return row ?? null;
}

export async function writeDraftFile(
	storyId: string,
	file: StoryFileInput,
	executor: DBExecutor = db,
): Promise<DBStoryDraftFile> {
	const path = normalizeStoryFilePath(file.path);
	assertFileSize(path, file.content);
	await assertFileCount(storyId, path, executor);

	const [row] = await executor
		.insert(s.storyDraftFile)
		.values({ storyId, path, content: file.content })
		.onConflictDoUpdate({
			target: [s.storyDraftFile.storyId, s.storyDraftFile.path],
			set: { content: file.content, updatedAt: new Date() },
		})
		.returning()
		.execute();
	return row;
}

export async function deleteDraftFile(storyId: string, path: string, executor: DBExecutor = db): Promise<boolean> {
	const deleted = await executor
		.delete(s.storyDraftFile)
		.where(and(eq(s.storyDraftFile.storyId, storyId), eq(s.storyDraftFile.path, normalizeStoryFilePath(path))))
		.returning({ id: s.storyDraftFile.id })
		.execute();
	return deleted.length > 0;
}

export async function replaceDraftFiles(storyId: string, files: StoryFileInput[]): Promise<DBStoryDraftFile[]> {
	return db.transaction(async (tx) => {
		await tx.delete(s.storyDraftFile).where(eq(s.storyDraftFile.storyId, storyId)).execute();
		return seedDraftFiles(storyId, files, tx);
	});
}

export async function seedDraftFiles(
	storyId: string,
	files: StoryFileInput[],
	executor: DBExecutor = db,
): Promise<DBStoryDraftFile[]> {
	const normalized = normalizeFileSet(files);
	if (normalized.length === 0) {
		return [];
	}
	return executor
		.insert(s.storyDraftFile)
		.values(normalized.map((file) => ({ storyId, ...file })))
		.returning()
		.execute();
}

export function listVersionFiles(storyVersionId: string, executor: DBExecutor = db): Promise<StoryFileWithContent[]> {
	return executor
		.select({ ...getTableColumns(s.storyFile), content: s.storyFileBlob.content })
		.from(s.storyFile)
		.innerJoin(s.storyFileBlob, eq(s.storyFile.contentHash, s.storyFileBlob.contentHash))
		.where(eq(s.storyFile.storyVersionId, storyVersionId))
		.orderBy(asc(s.storyFile.path))
		.execute();
}

export async function getVersionFile(
	storyVersionId: string,
	path: string,
	executor: DBExecutor = db,
): Promise<StoryFileWithContent | null> {
	const [row] = await executor
		.select({ ...getTableColumns(s.storyFile), content: s.storyFileBlob.content })
		.from(s.storyFile)
		.innerJoin(s.storyFileBlob, eq(s.storyFile.contentHash, s.storyFileBlob.contentHash))
		.where(and(eq(s.storyFile.storyVersionId, storyVersionId), eq(s.storyFile.path, normalizeStoryFilePath(path))))
		.execute();
	return row ?? null;
}

export async function cutVersionFromDraft(data: {
	storyId: string;
	action: DBStoryVersion['action'];
	source: DBStoryVersion['source'];
}): Promise<{ version: DBStoryVersion; files: DBStoryFile[] }> {
	return db.transaction(async (tx) => {
		const draft = await listDraftFiles(data.storyId, tx);
		if (draft.length === 0) {
			throw new StoryFileLimitError('The story has no draft files to publish.');
		}

		await upsertFileBlobs(
			draft.map((file) => file.content),
			tx,
		);

		const nextVersion = tx
			.select({ v: sql<number>`coalesce(max(${s.storyVersion.version}), 0) + 1` })
			.from(s.storyVersion)
			.where(eq(s.storyVersion.storyId, data.storyId));

		const [version] = await tx
			.insert(s.storyVersion)
			.values({
				storyId: data.storyId,
				code: '',
				action: data.action,
				source: data.source,
				version: sql`(${nextVersion})`,
			})
			.returning()
			.execute();

		const files = await tx
			.insert(s.storyFile)
			.values(
				draft.map((file) => ({
					storyVersionId: version.id,
					path: file.path,
					contentHash: hashContent(file.content),
				})),
			)
			.returning()
			.execute();

		return { version, files };
	});
}

async function upsertFileBlobs(contents: string[], executor: DBExecutor): Promise<void> {
	const unique = new Map(contents.map((content) => [hashContent(content), content]));
	const values = [...unique.entries()].map(([contentHash, content]) => ({
		contentHash,
		content,
		size: Buffer.byteLength(content, 'utf8'),
	}));
	if (values.length === 0) {
		return;
	}
	await executor
		.insert(s.storyFileBlob)
		.values(values)
		.onConflictDoNothing({ target: s.storyFileBlob.contentHash })
		.execute();
}

export async function restoreDraftFromVersion(storyId: string, storyVersionId: string): Promise<DBStoryDraftFile[]> {
	const files = await listVersionFiles(storyVersionId);
	return replaceDraftFiles(
		storyId,
		files.map((file) => ({ path: file.path, content: file.content })),
	);
}

export async function getVersionBundle(storyVersionId: string): Promise<DBStoryBundle | null> {
	const [row] = await db
		.select()
		.from(s.storyBundle)
		.where(eq(s.storyBundle.storyVersionId, storyVersionId))
		.execute();
	return row ?? null;
}

export async function setVersionBundle(
	storyVersionId: string,
	result: { bundle: string; bundleError: null } | { bundle: null; bundleError: string },
): Promise<void> {
	await db
		.insert(s.storyBundle)
		.values({ storyVersionId, ...result })
		.onConflictDoUpdate({ target: s.storyBundle.storyVersionId, set: { ...result, builtAt: new Date() } })
		.execute();
}

export function hashContent(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

function normalizeFileSet(files: StoryFileInput[]): StoryFileInput[] {
	if (files.length > MAX_STORY_FILES) {
		throw new StoryFileLimitError(`A story can hold at most ${MAX_STORY_FILES} files.`);
	}
	const seen = new Set<string>();
	return files.map((file) => {
		const path = normalizeStoryFilePath(file.path);
		if (seen.has(path)) {
			throw new StoryFileLimitError(`Duplicate file path "${path}".`);
		}
		seen.add(path);
		assertFileSize(path, file.content);
		return { path, content: file.content };
	});
}

function assertFileSize(path: string, content: string) {
	const bytes = Buffer.byteLength(content, 'utf8');
	if (bytes > MAX_STORY_FILE_BYTES) {
		throw new StoryFileLimitError(
			`"${path}" is ${Math.round(bytes / 1024)}KB; files are capped at ${MAX_STORY_FILE_BYTES / 1024}KB.`,
		);
	}
}

async function assertFileCount(storyId: string, path: string, executor: DBExecutor) {
	const [row] = await executor
		.select({ count: sql<number>`count(*)` })
		.from(s.storyDraftFile)
		.where(and(eq(s.storyDraftFile.storyId, storyId), sql`${s.storyDraftFile.path} <> ${path}`))
		.execute();
	if (Number(row?.count ?? 0) >= MAX_STORY_FILES) {
		throw new StoryFileLimitError(`A story can hold at most ${MAX_STORY_FILES} files.`);
	}
}
