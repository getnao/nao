export interface StoryQuerySource {
	fingerprint: string;
	databaseId: string | null;
	adminMode: boolean;
}

export type StoryQuerySources = Record<string, StoryQuerySource>;
