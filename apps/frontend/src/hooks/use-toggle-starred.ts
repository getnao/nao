import { useMutation } from '@tanstack/react-query';
import { trpc } from '@/main';

export const useToggleStarred = () => {
	return useMutation(
		trpc.chat.toggleStarred.mutationOptions({
			onMutate: (vars, ctx) => {
				const listKey = trpc.chat.list.queryKey();
				const getKey = trpc.chat.get.queryKey({ chatId: vars.chatId });

				const previousList = ctx.client.getQueryData(listKey);
				const previousChat = ctx.client.getQueryData(getKey);

				ctx.client.setQueryData(listKey, (prev) => {
					if (!prev) {
						return prev;
					}
					return {
						...prev,
						chats: prev.chats.map((c) => (c.id === vars.chatId ? { ...c, isStarred: vars.isStarred } : c)),
					};
				});
				ctx.client.setQueryData(getKey, (prev) => {
					if (!prev) {
						return prev;
					}
					return { ...prev, isStarred: vars.isStarred };
				});

				return { previousList, previousChat };
			},
			onError: (_err, vars, context, ctx) => {
				if (!context) {
					return;
				}
				ctx.client.setQueryData(trpc.chat.list.queryKey(), context.previousList);
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId: vars.chatId }), context.previousChat);
			},
			onSettled: (_data, _err, vars, _context, ctx) => {
				ctx.client.invalidateQueries({ queryKey: trpc.chat.list.queryKey() });
				ctx.client.invalidateQueries({
					queryKey: trpc.chat.get.queryKey({ chatId: vars.chatId }),
				});
			},
		}),
	);
};
