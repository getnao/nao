import type { StoryFormat } from '@nao/shared/types';

export interface QueryArtifact {
	id: string;
	title?: string;
	columns: string[];
	rowCount: number;
}

export interface StoryArtifact {
	id: string;
	title: string;
	version: number;
	format: StoryFormat;
	code: string;
	/** Draft files of a custom story, under `/stories/<id>/`. */
	files: string[];
	editedByUser: boolean;
	templateWarnings: string[];
}

/**
 * What a conversation produced so far and may refer to again: its query results and its
 * stories. Rebuilt from the chat on every turn, so the exact ids and the current content stay
 * in context whatever happened to the message history.
 */
export interface ChatArtifacts {
	queries: QueryArtifact[];
	stories: StoryArtifact[];
}
