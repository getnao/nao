import { isListedInContextHub } from '@/lib/context-hub';

export interface RecommendationFileEdit {
	path: string;
	kind: 'edit' | 'create';
	oldContent: string;
	newContent: string;
	targetRepo?: unknown;
}

export interface RecommendationWithEdits {
	id: string;
	fixKind: string | null;
	proposedEdits: RecommendationFileEdit[] | null;
}

/** The edits of a recommendation that change context files, which the Context Hub opens, keyed by their hub path. */
export function listContextFileEdits(recommendation: RecommendationWithEdits): RecommendationFileEdit[] {
	if (recommendation.fixKind !== 'patch') {
		return [];
	}
	return (recommendation.proposedEdits ?? [])
		.filter((edit) => !edit.targetRepo)
		.map((edit) => ({ ...edit, path: toContextHubPath(edit.path) }));
}

/**
 * Whether the Context Hub can show the file an edit changes: a file that exists already, listed in the doc view unless
 * the user also has the file tree. A file the edit creates only shows up once the recommendation is applied.
 */
export function isOpenableInContextHub(edit: RecommendationFileEdit, canUseFileTree: boolean): boolean {
	return !edit.targetRepo && edit.kind === 'edit' && (canUseFileTree || isListedInContextHub(edit.path));
}

/** The edits a recommendation proposes on context files, the one on the given file first. */
export function listContextFileEditsStartingWith(
	recommendation: RecommendationWithEdits,
	path: string,
): RecommendationFileEdit[] {
	const edits = listContextFileEdits(recommendation);
	return [...edits.filter((edit) => edit.path === path), ...edits.filter((edit) => edit.path !== path)];
}

/** The recommendations proposing a change to each context file, in the order they are given. */
export function groupRecommendationsByFile<Recommendation extends RecommendationWithEdits>(
	recommendations: readonly Recommendation[],
): Map<string, Recommendation[]> {
	const recommendationsByPath = new Map<string, Recommendation[]>();
	for (const recommendation of recommendations) {
		for (const edit of listContextFileEdits(recommendation)) {
			recommendationsByPath.set(edit.path, [...(recommendationsByPath.get(edit.path) ?? []), recommendation]);
		}
	}
	return recommendationsByPath;
}

/** Proposed edits name files from the project root, while the Context Hub paths start with a slash. */
export function toContextHubPath(path: string): string {
	return `/${path.replace(/^\/+/, '')}`;
}
