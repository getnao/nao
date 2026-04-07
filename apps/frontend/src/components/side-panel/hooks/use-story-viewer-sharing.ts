import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

interface UseStoryViewerSharingParams {
	chatId: string;
	storySlug: string;
}

export const useStoryViewerSharing = ({ chatId, storySlug }: UseStoryViewerSharingParams) => {
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const shareQuery = useQuery(trpc.storyShare.findByStory.queryOptions({ chatId, storySlug }));
	const isShared = Boolean(shareQuery.data?.shareId);

	return {
		isShareDialogOpen,
		setIsShareDialogOpen,
		isShared,
	};
};
