import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

interface UseChatSharingParams {
	chatId: string;
	isOwned: boolean;
}

export const useChatSharing = ({ chatId, isOwned }: UseChatSharingParams) => {
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const shareQuery = useQuery(
		trpc.chatShare.findByChat.queryOptions(
			{ chatId },
			{
				enabled: isOwned && isShareDialogOpen,
			},
		),
	);
	const isShared = Boolean(shareQuery.data?.shareId);

	return {
		isShareDialogOpen,
		setIsShareDialogOpen,
		isShared,
	};
};
