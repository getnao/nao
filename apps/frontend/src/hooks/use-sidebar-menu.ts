import { useQuery } from '@tanstack/react-query';
import { resolveSidebarMenu } from '@nao/shared/sidebar-menu';
import type { SidebarMenuEntry, StoriesPageFilters } from '@nao/shared/sidebar-menu';

import { trpc } from '@/main';

const DEFAULT_SIDEBAR_MENU_ENTRIES = resolveSidebarMenu(null);

export function useSidebarMenu(enabled = true) {
	const menu = useQuery({ ...trpc.sidebarMenu.get.queryOptions(), enabled, staleTime: 60_000 });
	return {
		entries: menu.data?.entries ?? DEFAULT_SIDEBAR_MENU_ENTRIES,
		isCustomizable: menu.data?.isCustomizable ?? false,
		isLoading: menu.isLoading,
	};
}

export function findStoriesPageEntry(
	entries: SidebarMenuEntry[],
	entryId: string | undefined,
): { label: string; filters: StoriesPageFilters } | null {
	const entry = entries.find((candidate) => candidate.id === entryId);
	return entry?.type === 'stories-page' ? entry : null;
}
