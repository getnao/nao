import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { StoryFilterSelections } from '@nao/shared/sql-template';

import type { StoryFilterApi, StoryFilterTargets, StoryQueryFilterStatuses } from '@/hooks/use-story-filters';

export type StoryQuerySqlSource = {
	api: StoryFilterApi;
	selections: StoryFilterSelections;
	/** Active filters in words, e.g. "Returned = false". */
	filterSummary?: string;
	queryFilterStatuses?: StoryQueryFilterStatuses;
	filterTargets?: StoryFilterTargets;
};

type StoryFilterHover = {
	hoveredFilterId: string | null;
	setHoveredFilterId: (filterId: string | null) => void;
};

const StoryQuerySqlContext = createContext<StoryQuerySqlSource | null>(null);
const StoryFilterHoverContext = createContext<StoryFilterHover | null>(null);

export function StoryQuerySqlProvider({ value, children }: { value: StoryQuerySqlSource | null; children: ReactNode }) {
	const [hoveredFilterId, setHoveredFilterId] = useState<string | null>(null);
	const hover = useMemo(() => ({ hoveredFilterId, setHoveredFilterId }), [hoveredFilterId]);
	return (
		<StoryQuerySqlContext.Provider value={value}>
			<StoryFilterHoverContext.Provider value={hover}>{children}</StoryFilterHoverContext.Provider>
		</StoryQuerySqlContext.Provider>
	);
}

/** The story filter the reader points at, so the charts it reaches can stand out. */
export function useStoryFilterHover(): StoryFilterHover | null {
	return useContext(StoryFilterHoverContext);
}

export function useStoryQuerySql(): StoryQuerySqlSource | null {
	return useContext(StoryQuerySqlContext);
}
