/** The tools of the Context Hub chat that change a context file, whose output names the files they changed. */
export const CONTEXT_EDITOR_FILE_TOOL_NAMES = [
	'edit_context_file',
	'create_context_file',
	'apply_recommendation',
] as const;

/** The tools of the Context Hub chat that change the recommendations shown beside the context. */
export const CONTEXT_EDITOR_RECOMMENDATION_TOOL_NAMES = ['apply_recommendation', 'set_recommendation_status'] as const;

export type ContextEditorFileToolName = (typeof CONTEXT_EDITOR_FILE_TOOL_NAMES)[number];

export interface ContextEditorFileChange {
	path: string;
}

export interface ContextRecommendationEditConflict {
	path: string;
	reason: string;
}

export interface ContextRecommendationApplyResult {
	recommendationId: string;
	title: string;
	/** Files the recommendation's edits were written to, in the user's changes. */
	changedPaths: string[];
	/** Files that already held the proposed content. */
	unchangedPaths: string[];
	conflicts: ContextRecommendationEditConflict[];
	status: 'open' | 'applied' | 'dismissed';
}

export function isContextEditorFileToolName(name: string): name is ContextEditorFileToolName {
	return CONTEXT_EDITOR_FILE_TOOL_NAMES.some((toolName) => toolName === name);
}

export function isContextEditorRecommendationToolName(name: string): boolean {
	return CONTEXT_EDITOR_RECOMMENDATION_TOOL_NAMES.some((toolName) => toolName === name);
}

/** The context files a settled tool call of the Context Hub chat changed. */
export function getChangedContextPaths(
	toolName: ContextEditorFileToolName,
	output: ContextEditorFileChange | ContextRecommendationApplyResult,
): string[] {
	if (toolName === 'apply_recommendation') {
		return (output as ContextRecommendationApplyResult).changedPaths;
	}
	return [(output as ContextEditorFileChange).path];
}
