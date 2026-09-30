import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

interface UseStoryViewerEnlargeParams {
	storyId: string | null;
}

export const useStoryViewerEnlarge = ({ storyId }: UseStoryViewerEnlargeParams) => {
	const navigate = useNavigate();

	const handleEnlarge = useCallback(() => {
		if (!storyId) {
			return;
		}
		navigate({ to: '/stories/$storyId', params: { storyId } });
	}, [storyId, navigate]);

	return {
		handleEnlarge,
	};
};
