import { useMemo, useState } from 'react';

import { FILTER_OPTIONS_PAGE_SIZE, searchFilterOptions } from '@/lib/story-filter-options';

/** Renders matching options one page at a time so long lists stay responsive; the page resets when the search changes. */
export function usePagedFilterOptions(options: string[], search: string) {
	const normalizedSearch = search.trim();
	const [page, setPage] = useState({ search: normalizedSearch, size: FILTER_OPTIONS_PAGE_SIZE });
	const pageSize = page.search === normalizedSearch ? page.size : FILTER_OPTIONS_PAGE_SIZE;

	const matches = useMemo(() => searchFilterOptions(options, normalizedSearch), [options, normalizedSearch]);
	const visibleOptions = useMemo(() => matches.slice(0, pageSize), [matches, pageSize]);

	const loadMore = () => {
		setPage({ search: normalizedSearch, size: pageSize + FILTER_OPTIONS_PAGE_SIZE });
	};

	return {
		options: visibleOptions,
		total: matches.length,
		search: normalizedSearch,
		hasMore: visibleOptions.length < matches.length,
		loadMore,
	};
}
