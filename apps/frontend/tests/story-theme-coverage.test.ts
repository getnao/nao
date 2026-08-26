import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard against a story render path silently missing the workspace theme.
 *
 * The first cut of the design system wrapped only `StoryPageBody`, which covers
 * the standalone, preview and shared routes. The side panel viewer and the MCP
 * embed render stories through their own trees, so a published theme applied to
 * some views and not others - it looked like the feature did nothing at all.
 *
 * Any new top-level story surface belongs in this list.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STORY_RENDER_ENTRY_POINTS = [
	'src/components/story-page-body.tsx',
	'src/components/side-panel/story-viewer.tsx',
	'src/routes/embed.story.$storyId.tsx',
];

describe('story theme coverage', () => {
	for (const file of STORY_RENDER_ENTRY_POINTS) {
		it(`${file} applies the workspace design system`, () => {
			const source = readFileSync(resolve(root, file), 'utf8');
			expect(source, `${file} does not import StoryThemeProvider`).toContain('StoryThemeProvider');
			expect(source, `${file} imports StoryThemeProvider but never renders it`).toMatch(
				/<StoryThemeProvider[\s>]/,
			);
		});
	}
});
