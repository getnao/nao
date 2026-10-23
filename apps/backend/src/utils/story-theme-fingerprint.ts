import { DEFAULT_STORY_THEME_PAIR, type StoryThemePair } from '@nao/shared/story-theme';
import { createHash } from 'crypto';

export function storyThemeFingerprint(theme: StoryThemePair | null): string {
	const pair = theme ?? DEFAULT_STORY_THEME_PAIR;
	return createHash('sha256')
		.update(JSON.stringify({ light: pair.light, dark: pair.dark }))
		.digest('hex')
		.slice(0, 12);
}
