import { useCallback, useState } from 'react';
import type { ChatFilterType, ChatGroupBy } from '@nao/shared/types';

const GROUP_BY_KEY = 'sidebar-chat-group-by';
const FILTERS_KEY = 'sidebar-chat-filters';

export function useChatViewPreferences() {
	const [groupBy, setGroupByState] = useState<ChatGroupBy>(
		() => (localStorage.getItem(GROUP_BY_KEY) as ChatGroupBy) || 'none',
	);

	const [filters, setFiltersState] = useState<ChatFilterType[]>(() => {
		try {
			const stored = localStorage.getItem(FILTERS_KEY);
			return stored ? JSON.parse(stored) : ['all'];
		} catch {
			return ['all'];
		}
	});

	const setGroupBy = useCallback((value: ChatGroupBy) => {
		setGroupByState(value);
		localStorage.setItem(GROUP_BY_KEY, value);
	}, []);

	const toggleFilter = useCallback((filter: ChatFilterType) => {
		setFiltersState((prev) => {
			let next: ChatFilterType[];
			if (filter === 'all') {
				next = ['all'];
			} else {
				const without = prev.filter((f) => f !== 'all');
				if (without.includes(filter)) {
					next = without.filter((f) => f !== filter);
				} else {
					next = [...without, filter];
				}
				if (next.length === 0) {
					next = ['all'];
				}
			}
			localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
			return next;
		});
	}, []);

	return { groupBy, filters, setGroupBy, toggleFilter };
}
