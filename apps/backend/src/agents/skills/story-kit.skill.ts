import { renderStoryKitGuide } from '../../components/ai/story-kit-guide';
import type { InternalSkill } from './types';

export const storyKitSkill: InternalSkill = {
	name: 'custom-story-kit',
	description:
		'How to write the source of a custom story with @nao/story-kit: blocks and their props, theming, layout (slides, canvas, tabs), filters and parameters, saved state, maps, models and HTML stories. Load this before writing or editing any file under /stories/. Only for custom stories: never load it for a classic (markdown) story.',
	body: () => `# Writing a custom story\n\n${renderStoryKitGuide()}`,
};
