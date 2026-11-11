import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { StoryReferences } from '@/lib/story-reference';
import { hasAnyStoryReference } from '@/lib/story-reference';
import { pendingStoryReferencesStore } from '@/stores/story-references';

/** Opens a new chat whose input references the given stories and story folders. */
export function useStartChatWithStories() {
	const navigate = useNavigate();
	return useCallback(
		(references: StoryReferences) => {
			if (!hasAnyStoryReference(references)) {
				return;
			}
			pendingStoryReferencesStore.set(references);
			navigate({ to: '/' });
		},
		[navigate],
	);
}
