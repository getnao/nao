import { describe, expect, it } from 'vitest';

import {
	extractStoryMapBoundaryKeys,
	fitMapBoundariesInExport,
	isStoryLinkUrl,
	MAX_STORY_EXPORT_BOUNDARY_BYTES,
	type StoryMapBoundary,
} from '../src/story-app';

describe('isStoryLinkUrl', () => {
	it.each([
		['https://crm.example.com/accounts/42', true],
		['http://intranet.local/report?id=1', true],
		['javascript:alert(1)', false],
		['data:text/html,<script>alert(1)</script>', false],
		['blob:https://app.example.com/1234', false],
		['mailto:someone@example.com', false],
		['/stories/relative', false],
		['not a url', false],
		[42, false],
	])('%s → %s', (value, expected) => {
		expect(isStoryLinkUrl(value)).toBe(expected);
	});
});

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

describe('fitMapBoundariesInExport', () => {
	it('leaves out a set that no longer fits the download, but keeps smaller ones after it', () => {
		const large = boundaryOfBytes(MAX_STORY_EXPORT_BOUNDARY_BYTES * 0.6);
		const small = boundaryOfBytes(1024);

		const kept = fitMapBoundariesInExport([
			['regions', large],
			['departments', large],
			['cities', small],
		]);

		expect(Object.keys(kept)).toEqual(['regions', 'cities']);
	});
});

function boundaryOfBytes(bytes: number): StoryMapBoundary {
	return {
		geojson: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { padding: 'x'.repeat(bytes) },
				},
			],
		},
		joinProperties: ['code'],
	};
}
