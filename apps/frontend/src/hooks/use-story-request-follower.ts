import { useEffect, useEffectEvent, useRef } from 'react';

import { isStoryRequestFor } from '@/stores/story-highlight';

interface FollowedRequest {
	id: number;
	storySlug?: string;
	requestedAt: number;
}

/** Calls `onRequest` once for each request about the story opened, so its view can show what was cited. */
export function useStoryRequestFollower<Request extends FollowedRequest>(
	request: Request | null,
	storySlug: string | undefined,
	onRequest: (request: Request) => void,
) {
	const followedRequestId = useRef<number | null>(null);
	const follow = useEffectEvent(onRequest);

	useEffect(() => {
		if (!request || followedRequestId.current === request.id || !isStoryRequestFor(request, storySlug)) {
			return;
		}
		followedRequestId.current = request.id;
		follow(request);
	}, [request, storySlug]);
}
