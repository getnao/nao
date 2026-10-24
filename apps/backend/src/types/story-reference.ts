import type { StoryFormat } from '@nao/shared/types';

export interface StorySummary {
	id: string;
	title: string;
	author: string | null;
	format: StoryFormat;
	pinned: boolean;
	certified: boolean;
	updatedAt: string;
}

export interface StoryFile {
	path: string;
	content: string;
}

export interface StoryQuery {
	queryId: string;
	databaseId?: string;
	sql: string;
}

/** A story with its content: the markdown of a classic story, or the published files of a custom one. */
export interface StoryDetails extends StorySummary {
	version: number;
	code: string;
	files: StoryFile[];
	queries: StoryQuery[];
}
