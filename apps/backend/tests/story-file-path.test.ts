import { describe, expect, it } from 'vitest';

import { isViewableStoryFile } from '../src/utils/story-file-path';

describe('isViewableStoryFile', () => {
	it.each(['app.tsx', 'components/chart.tsx', 'styles/theme.css'])('shows %s', (path) => {
		expect(isViewableStoryFile(path)).toBe(true);
	});

	it.each([
		'secret.ts',
		'config/api-key.json',
		'api.key.json',
		'private.key.json',
		'secrets/config.json',
		'private-key/a.ts',
		'lib\\secrets\\a.ts',
	])('hides %s', (path) => {
		expect(isViewableStoryFile(path)).toBe(false);
	});
});
