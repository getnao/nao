import type { QueryClient } from '@tanstack/react-query';

import { trpc } from '@/main';

export function invalidateStoriesCaches(queryClient: QueryClient): void {
	void queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.story.listStandaloneArchived.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.story.listSharedArchived.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
	void queryClient.invalidateQueries({ queryKey: trpc.favorite.list.queryKey() });
}
