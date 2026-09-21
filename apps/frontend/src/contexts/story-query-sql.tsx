import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { StoryFilterSelections } from '@nao/shared/sql-template';

import type { StoryFilterApi } from '@/hooks/use-story-filters';

export type StoryQuerySqlSource = {
	api: StoryFilterApi;
	selections: StoryFilterSelections;
};

const StoryQuerySqlContext = createContext<StoryQuerySqlSource | null>(null);

export function StoryQuerySqlProvider({ value, children }: { value: StoryQuerySqlSource | null; children: ReactNode }) {
	return <StoryQuerySqlContext.Provider value={value}>{children}</StoryQuerySqlContext.Provider>;
}

export function useStoryQuerySql(): StoryQuerySqlSource | null {
	return useContext(StoryQuerySqlContext);
}
