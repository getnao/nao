import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

interface UseStoryViewerEnlargeParams {
	chatId: string;
	storyId: string;
}

export const useStoryViewerEnlarge = ({ chatId, storyId }: UseStoryViewerEnlargeParams) => {
	const navigate = useNavigate();

	const handleEnlarge = useCallback(() => {
		navigate({ to: '/stories/preview/$chatId/$storyId', params: { chatId, storyId } });
	}, [chatId, storyId, navigate]);

	return {
		handleEnlarge,
	};
};
