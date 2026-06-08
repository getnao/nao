import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

type FavoriteType = 'story' | 'folder';

type FavoriteList = { storyIds?: string[]; folderIds?: string[] };

const ID_FIELD: Record<FavoriteType, keyof FavoriteList> = {
	story: 'storyIds',
	folder: 'folderIds',
};

export function useToggleFavorite(type: FavoriteType) {
	const queryClient = useQueryClient();
	const field = ID_FIELD[type];

	const mutation = useMutation(
		trpc.favorite.toggle.mutationOptions({
			onMutate: async ({ id }) => {
				const queryKey = trpc.favorite.list.queryKey();
				await queryClient.cancelQueries({ queryKey });
				const previous = queryClient.getQueryData(queryKey);
				queryClient.setQueryData(queryKey, (old: typeof previous) => {
					if (!old) {
						return old;
					}
					const ids: string[] = (old as FavoriteList)[field] ?? [];
					const alreadyFavorited = ids.includes(id);
					return {
						...old,
						[field]: alreadyFavorited ? ids.filter((existing) => existing !== id) : [...ids, id],
					};
				});
				return { previous };
			},
			onError: (_err, _vars, context) => {
				if (context?.previous !== undefined) {
					queryClient.setQueryData(trpc.favorite.list.queryKey(), context.previous);
				}
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: trpc.favorite.list.queryKey() });
			},
		}),
	);

	function isFavorited(id: string): boolean {
		const data = queryClient.getQueryData(trpc.favorite.list.queryKey()) as FavoriteList | undefined;
		return data?.[field]?.includes(id) ?? false;
	}

	function toggle(id: string) {
		mutation.mutate({ type, id });
	}

	return { toggle, isFavorited, isPending: mutation.isPending };
}
