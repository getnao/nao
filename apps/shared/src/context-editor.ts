/** The tools of the Context Hub chat that change a context file, whose output names the file they changed. */
export const CONTEXT_EDITOR_FILE_TOOL_NAMES = ['edit_context_file', 'create_context_file'] as const;

export type ContextEditorFileToolName = (typeof CONTEXT_EDITOR_FILE_TOOL_NAMES)[number];

export interface ContextEditorFileChange {
	path: string;
}

export function isContextEditorFileToolName(name: string): name is ContextEditorFileToolName {
	return CONTEXT_EDITOR_FILE_TOOL_NAMES.some((toolName) => toolName === name);
}
