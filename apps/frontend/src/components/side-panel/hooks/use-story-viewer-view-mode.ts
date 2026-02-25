import { useState } from 'react';
import type { StoryViewMode } from '../story-viewer.types';

export const useStoryViewerViewMode = () => {
	const [viewMode, setViewMode] = useState<StoryViewMode>('preview');

	return {
		viewMode,
		setViewMode,
	};
};
