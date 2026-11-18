import type { ContextRecommendationApplyResult, ContextRecommendationEditConflict } from '@nao/shared/context-editor';
import { TRPCError } from '@trpc/server';

import type { DBContextRecommendation } from '../db/abstractSchema';
import * as crQueries from '../queries/context-recommendation.queries';
import type { ProposedEdit } from '../types/context-recommendation';
import { HandlerError } from '../utils/error';
import type { ContextExplorerFileAccess } from './context-explorer.service';
import { createDraftFile, readFileContent, writeFileContent } from './context-explorer.service';
import { createStrictFileAccess } from './context-explorer-access.service';

interface ContextEditor {
	id: string;
	name: string;
	email: string;
}

interface ApplyRecommendationInput {
	projectId: string;
	projectFolder: string | null;
	editor: ContextEditor;
	recommendationId: string;
}

type EditOutcome = { type: 'changed' } | { type: 'unchanged' } | { type: 'conflict'; reason: string };

const SNIPPET_CONTEXT_LINES = 1;

interface CurrentFile {
	content: string;
	hash: string;
}

/**
 * Writes the file edits nao proposed for a recommendation into the user's changes, like edits made in the Context Hub,
 * and marks the recommendation applied once every edit landed. A file that changed since the analysis still gets the
 * edit when the changed snippet can be found in it; otherwise the edit is reported as a conflict to apply by hand.
 */
export async function applyRecommendationToChanges({
	projectId,
	projectFolder,
	editor,
	recommendationId,
}: ApplyRecommendationInput): Promise<ContextRecommendationApplyResult> {
	const recommendation = await getRecommendationWithEdits(projectId, recommendationId);
	const access = await createStrictFileAccess(projectId, projectFolder, editor);
	const changedPaths: string[] = [];
	const unchangedPaths: string[] = [];
	const conflicts: ContextRecommendationEditConflict[] = [];

	for (const edit of recommendation.proposedEdits ?? []) {
		const path = toExplorerPath(edit.path);
		const outcome = await applyEdit(edit, path, access);
		if (outcome.type === 'changed') {
			changedPaths.push(path);
		} else if (outcome.type === 'unchanged') {
			unchangedPaths.push(path);
		} else {
			conflicts.push({ path, reason: outcome.reason });
		}
	}

	const isFullyApplied = conflicts.length === 0;
	if (isFullyApplied) {
		await crQueries.setRecommendationStatus({
			id: recommendation.id,
			projectId,
			status: 'applied',
			userId: editor.id,
		});
	}
	return {
		recommendationId: recommendation.id,
		title: recommendation.title,
		changedPaths,
		unchangedPaths,
		conflicts,
		status: isFullyApplied ? 'applied' : recommendation.status,
	};
}

/**
 * The lines of a file an edit changes, without the lines it keeps before and after, except for `contextLines` of them
 * on each side, which anchor the snippet when it is looked for in a file that changed since.
 */
export function extractChangedSnippet(
	oldContent: string,
	newContent: string,
	contextLines = 0,
): { removed: string; added: string } {
	const oldLines = splitLines(oldContent);
	const newLines = splitLines(newContent);
	const prefixLength = commonPrefixLength(oldLines, newLines);
	const suffixLength = commonSuffixLength(
		oldLines,
		newLines,
		Math.min(oldLines.length, newLines.length) - prefixLength,
	);
	const start = Math.max(0, prefixLength - contextLines);
	const keptSuffixLength = Math.max(0, suffixLength - contextLines);
	return {
		removed: oldLines.slice(start, oldLines.length - keptSuffixLength).join(''),
		added: newLines.slice(start, newLines.length - keptSuffixLength).join(''),
	};
}

async function getRecommendationWithEdits(
	projectId: string,
	recommendationId: string,
): Promise<DBContextRecommendation> {
	const recommendation = await crQueries.getRecommendationById(projectId, recommendationId);
	if (!recommendation) {
		throw new HandlerError('NOT_FOUND', `Recommendation ${recommendationId} not found in this project.`);
	}
	if (recommendation.fixKind !== 'patch' || !recommendation.proposedEdits?.length) {
		throw new HandlerError(
			'BAD_REQUEST',
			'This recommendation has no file edits to apply: it has to be fixed by hand or at the source.',
		);
	}
	return recommendation;
}

async function applyEdit(edit: ProposedEdit, path: string, access: ContextExplorerFileAccess): Promise<EditOutcome> {
	if (edit.targetRepo) {
		return {
			type: 'conflict',
			reason: `It changes ${edit.targetRepo.repoFullName}, a linked repository: open a pull request from the recommendations page.`,
		};
	}
	try {
		const current = await readCurrentFile(path, access);
		const content = resolveNewContent(edit, current);
		if (content === null) {
			return { type: 'conflict', reason: 'The file changed since nao proposed this edit: apply it by hand.' };
		}
		if (current?.content === content) {
			return { type: 'unchanged' };
		}
		await writeEditedFile(path, content, current, access);
		return { type: 'changed' };
	} catch (error) {
		return { type: 'conflict', reason: error instanceof Error ? error.message : 'The edit could not be saved.' };
	}
}

function resolveNewContent(edit: ProposedEdit, current: CurrentFile | null): string | null {
	if (!current) {
		return edit.oldContent === '' ? edit.newContent : null;
	}
	if (current.content === edit.oldContent || current.content === edit.newContent) {
		return edit.newContent;
	}
	const { removed, added } = extractChangedSnippet(edit.oldContent, edit.newContent, SNIPPET_CONTEXT_LINES);
	if (added && current.content.includes(added) && !current.content.includes(removed)) {
		return current.content;
	}
	return replaceUniqueSnippet(current.content, removed, added);
}

function replaceUniqueSnippet(content: string, removed: string, added: string): string | null {
	const index = removed ? content.indexOf(removed) : -1;
	if (index === -1 || content.indexOf(removed, index + 1) !== -1) {
		return null;
	}
	return content.slice(0, index) + added + content.slice(index + removed.length);
}

async function readCurrentFile(path: string, access: ContextExplorerFileAccess): Promise<CurrentFile | null> {
	try {
		const file = await readFileContent(path, access);
		return { content: file.content, hash: file.hash };
	} catch (error) {
		if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
			return null;
		}
		throw error;
	}
}

async function writeEditedFile(
	path: string,
	content: string,
	current: CurrentFile | null,
	access: ContextExplorerFileAccess,
): Promise<void> {
	if (current) {
		await writeFileContent(path, content, current.hash, access);
		return;
	}
	await createDraftFile(path, content, access);
}

function splitLines(content: string): string[] {
	return content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function commonPrefixLength(left: string[], right: string[]): number {
	const maxLength = Math.min(left.length, right.length);
	let length = 0;
	while (length < maxLength && left[length] === right[length]) {
		length++;
	}
	return length;
}

function commonSuffixLength(left: string[], right: string[], maxLength: number): number {
	let length = 0;
	while (length < maxLength && left[left.length - 1 - length] === right[right.length - 1 - length]) {
		length++;
	}
	return length;
}

function toExplorerPath(path: string): string {
	return `/${path.replace(/^\/+/, '')}`;
}
