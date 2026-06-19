import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import type { QueryDataMap } from '@/components/story-embeds';

const StoryEmbedDataContext = createContext<QueryDataMap | null>(null);

export function StoryEmbedDataProvider({ value, children }: { value: QueryDataMap | null; children: ReactNode }) {
	return <StoryEmbedDataContext.Provider value={value}>{children}</StoryEmbedDataContext.Provider>;
}

export function useStoryEmbedData(): QueryDataMap | null {
	return useContext(StoryEmbedDataContext);
}
