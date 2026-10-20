import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { generateStoryHtml } from '../src/utils/story-html';

const MAP_BLOCK = '<map query_id="q1" map_type="scatter" latitude_key="lat" longitude_key="lng" />';

const installedVersion: string = JSON.parse(
	readFileSync(createRequire(import.meta.url).resolve('maplibre-gl/package.json'), 'utf8'),
).version;

describe('generateStoryHtml MapLibre loading', () => {
	it('imports the installed maplibre-gl ES module and its worker from the CDN', async () => {
		const html = await generateStoryHtml({ title: 'Story', code: MAP_BLOCK }, null);

		expect(html).toContain(`https://unpkg.com/maplibre-gl@${installedVersion}/dist/maplibre-gl.mjs`);
		expect(html).toContain(`https://unpkg.com/maplibre-gl@${installedVersion}/dist/maplibre-gl-worker.mjs`);
		expect(html).toContain(`https://unpkg.com/maplibre-gl@${installedVersion}/dist/maplibre-gl.css`);
		expect(html).not.toMatch(/<script[^>]+src="[^"]*maplibre-gl/);
	});

	it('loads no MapLibre for static maps', async () => {
		const html = await generateStoryHtml({ title: 'Story', code: MAP_BLOCK }, null, null, [], {
			staticMaps: true,
		});

		expect(html).not.toContain('maplibre-gl');
	});
});
