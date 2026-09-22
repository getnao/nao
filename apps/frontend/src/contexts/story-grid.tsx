import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const StoryGridContext = createContext(false);

export function StoryGridProvider({ children }: { children: ReactNode }) {
	return <StoryGridContext.Provider value={true}>{children}</StoryGridContext.Provider>;
}

export function useIsInStoryGrid(): boolean {
	return useContext(StoryGridContext);
}
