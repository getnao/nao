import { useMutation } from '@tanstack/react-query';
import { trpc } from '@/main';

export const useToggleStarred = () => {
	return useMutation(
		trpc.chat.toggleStarred.mutationOptions({
			onMutate: (vars, ctx) => {
				ctx.client.setQueryData(trpc.chat.list.queryKey(), (prev) => {
					if (!prev) {
						return prev;
					}
					return {
						...prev,
						chats: prev.chats.map((c) => (c.id === vars.chatId ? { ...c, isStarred: vars.isStarred } : c)),
					};
				});
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId: vars.chatId }), (prev) => {
					if (!prev) {
						return prev;
					}
					return { ...prev, isStarred: vars.isStarred };
				});
			},
		}),
	);
};
