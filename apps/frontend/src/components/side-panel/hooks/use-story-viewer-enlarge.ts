import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

interface UseStoryViewerEnlargeParams {
	chatId: string;
	storySlug: string;
}

export const useStoryViewerEnlarge = ({ chatId, storySlug }: UseStoryViewerEnlargeParams) => {
	const navigate = useNavigate();

	const handleEnlarge = useCallback(() => {
		navigate({ to: '/stories/preview/$chatId/$storySlug', params: { chatId, storySlug } });
	}, [chatId, storySlug, navigate]);

	return {
		handleEnlarge,
	};
};
