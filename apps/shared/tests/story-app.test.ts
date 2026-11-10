import { describe, expect, it } from 'vitest';

import { extractStoryMapBoundaryKeys } from '../src/story-app';

describe('extractStoryMapBoundaryKeys', () => {
	it('finds the keys loaded by React and HTML stories, once each', () => {
		const sources = [
			`const regions = useMapBoundary('france_regions');\nconst again = useMapBoundary("france_regions");`,
			'const postal = await nao.mapBoundary(`french_postal_codes`);',
		];

		expect(extractStoryMapBoundaryKeys(sources)).toEqual(['france_regions', 'french_postal_codes']);
	});

	it('accepts whitespace around the opening parenthesis', () => {
		expect(extractStoryMapBoundaryKeys(['useMapBoundary ( "world_countries" )'])).toEqual(['world_countries']);
	});

	it('ignores keys that are not string literals', () => {
		expect(extractStoryMapBoundaryKeys(['useMapBoundary(selectedKey)'])).toEqual([]);
	});
});
