export interface StoryQuerySource {
	fingerprint: string;
	databaseId: string | null;
	adminMode: boolean;
	credentialScope?: 'shared';
}

export type StoryQuerySources = Record<string, StoryQuerySource>;
