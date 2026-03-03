import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

interface UseStoryViewerSharingParams {
	chatId: string;
	storyId: string;
}

export const useStoryViewerSharing = ({ chatId, storyId }: UseStoryViewerSharingParams) => {
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const shareQuery = useQuery(trpc.storyShare.findByStory.queryOptions({ chatId, storyId }));
	const isShared = Boolean(shareQuery.data?.shareId);

	return {
		isShareDialogOpen,
		setIsShareDialogOpen,
		isShared,
	};
};
