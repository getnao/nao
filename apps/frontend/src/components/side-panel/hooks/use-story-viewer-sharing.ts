import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

type UseStoryViewerSharingParams = { chatId: string; storySlug: string } | { storyId: string };

export const useStoryViewerSharing = (story: UseStoryViewerSharingParams) => {
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const shareQuery = useQuery(trpc.storyShare.getSharedStoryInfo.queryOptions(story));
	const isShared = shareQuery.data?.isShared === true;

	return {
		isShareDialogOpen,
		setIsShareDialogOpen,
		isShared,
	};
};
