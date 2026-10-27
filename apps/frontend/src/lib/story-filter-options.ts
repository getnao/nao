export const FILTER_OPTIONS_PAGE_SIZE = 50;

export function searchFilterOptions(options: string[], search: string): string[] {
	const normalizedSearch = search.trim().toLowerCase();
	if (!normalizedSearch) {
		return options;
	}
	return options.filter((option) => option.toLowerCase().includes(normalizedSearch));
}

export function formatFilterResultSummary(search: string, shown: number, total: number): string {
	if (search) {
		const matches = `${total.toLocaleString()} ${total === 1 ? 'match' : 'matches'} for “${search}”`;
		return shown < total ? `${matches} · showing ${shown.toLocaleString()}` : matches;
	}
	return shown < total
		? `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} options`
		: `${total.toLocaleString()} ${total === 1 ? 'option' : 'options'}`;
}
