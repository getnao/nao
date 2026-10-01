import { createLocalStorage } from '@/lib/local-storage';

export const HOME_STORIES_MODES = ['latest', 'smart'] as const;
export type HomeStoriesMode = (typeof HOME_STORIES_MODES)[number];

export const HOME_STORIES_MODE_LABELS: Record<HomeStoriesMode, string> = {
	latest: 'Latest',
	smart: 'For you',
};

export const HOME_STORIES_MODE_DESCRIPTIONS: Record<HomeStoriesMode, string> = {
	latest: 'Favorites, pinned and most recent stories',
	smart: 'Stories and chats you tend to open at this time',
};

const storage = createLocalStorage<HomeStoriesMode>('nao-home-stories-mode', 'latest');

export function readHomeStoriesMode(): HomeStoriesMode {
	const stored = storage.get();
	return HOME_STORIES_MODES.includes(stored) ? stored : 'latest';
}

export function writeHomeStoriesMode(mode: HomeStoriesMode): void {
	storage.set(mode);
}
