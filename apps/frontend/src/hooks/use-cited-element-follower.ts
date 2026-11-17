import type { CitedStoryElementRequest } from '@/stores/cited-story-element';

import { useStoryRequestFollower } from '@/hooks/use-story-request-follower';
import { useCitedStoryElementRequest } from '@/stores/cited-story-element';

export function useCitedElementFollower(
	storySlug: string | undefined,
	onRequest: (request: CitedStoryElementRequest) => void,
) {
	useStoryRequestFollower(useCitedStoryElementRequest(), storySlug, onRequest);
}
