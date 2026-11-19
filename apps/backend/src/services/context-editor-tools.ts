import type { ContextEditorFileChange } from '@nao/shared/context-editor';
import { z } from 'zod/v4';

import type { ToolContext } from '../types/tools';
import { createTool } from '../utils/tools';
import { createDraftFile, readFileContent, writeFileContent } from './context-explorer.service';
import { createSafeFileAccess, createStrictFileAccess } from './context-explorer-access.service';

interface ContextEditor {
	id: string;
	name: string;
	email: string;
}

interface ReadContextFileOutput {
	path: string;
	content: string;
	isEditable: boolean;
	readOnlyReason: string | null;
}

const pathSchema = z
	.string()
	.trim()
	.min(1)
	.max(2_000)
	.describe('Project path of the context file, e.g. RULES.md or docs/glossary.md.');

const editInputSchema = z.object({
	path: pathSchema,
	old_string: z.string().min(1).describe('Exact text to replace, which must appear exactly once in the file.'),
	new_string: z.string().describe('The text replacing it.'),
});

const createInputSchema = z.object({
	path: pathSchema,
	content: z
		.string()
		.max(1024 * 1024)
		.describe('The full content of the new file.'),
});

/**
 * Tools reading and changing context files as the user's own changes, like edits made in the Context Hub: they land
 * in the user's draft or File Explorer branch, never in the live context, and the user publishes them for review.
 */
export function createContextEditorTools(editor: ContextEditor) {
	return {
		read_context_file: createTool<{ path: string }, ReadContextFileOutput>({
			description:
				'Read a context file as it stands in the user’s changes, including edits not published yet, and whether the user may edit it. Read a file before editing it.',
			inputSchema: z.object({ path: pathSchema }),
			execute: async ({ path }, context) => {
				const access = await createSafeFileAccess(context.projectId, context.projectFolder, editor);
				const file = await readFileContent(toExplorerPath(path), access);
				return {
					path: toExplorerPath(path),
					content: file.content,
					isEditable: file.isEditable,
					readOnlyReason: file.isEditable ? null : (file.guidance?.message ?? file.reason),
				};
			},
		}),
		edit_context_file: createTool<z.infer<typeof editInputSchema>, ContextEditorFileChange>({
			description:
				'Change part of an existing context file by replacing one exact snippet. The change is saved in the user’s changes and shows up in the Context Hub right away; it reaches the agent once the user publishes it.',
			inputSchema: editInputSchema,
			execute: async ({ path, old_string, new_string }, context) => {
				const explorerPath = toExplorerPath(path);
				const access = await createStrictFileAccess(context.projectId, context.projectFolder, editor);
				const file = await readFileContent(explorerPath, access);
				const content = replaceOnce(file.content, old_string, new_string, explorerPath);
				await writeFileContent(explorerPath, content, file.hash, access);
				return { path: explorerPath };
			},
		}),
		create_context_file: createTool<z.infer<typeof createInputSchema>, ContextEditorFileChange>({
			description:
				'Create a new context file, such as a doc under docs/ or a skill under agent/skills/<name>.md. It is saved in the user’s changes, like edit_context_file.',
			inputSchema: createInputSchema,
			execute: async ({ path, content }, context: ToolContext) => {
				const explorerPath = toExplorerPath(path);
				const access = await createStrictFileAccess(context.projectId, context.projectFolder, editor);
				await createDraftFile(explorerPath, content, access);
				return { path: explorerPath };
			},
		}),
	};
}

function replaceOnce(content: string, oldString: string, newString: string, path: string): string {
	const index = content.indexOf(oldString);
	if (index === -1) {
		throw new Error(`The text to replace was not found in ${path}. Read the file again and copy it exactly.`);
	}
	if (content.indexOf(oldString, index + 1) !== -1) {
		throw new Error(`The text to replace appears several times in ${path}. Include more surrounding lines.`);
	}
	return content.slice(0, index) + newString + content.slice(index + oldString.length);
}

function toExplorerPath(path: string): string {
	return `/${path.replace(/^\/+/, '')}`;
}
