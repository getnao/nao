import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

const dbtChartsInstalled = vi.hoisted(() => ({ value: true }));

vi.mock('../src/services/dbt-charts-status', () => ({
	isDbtChartsAvailable: () => dbtChartsInstalled.value,
	getDbtChartsStatus: async () => ({ available: dbtChartsInstalled.value, version: null, install_hint: null }),
}));

import { buildStoryToolDescription } from '../src/agents/tools/story';
import { resolveStoryStyle } from '../src/services/story-style';

beforeEach(() => {
	dbtChartsInstalled.value = true;
});

describe('resolveStoryStyle', () => {
	it('defaults to markdown stories', () => {
		expect(resolveStoryStyle(null)).toBe('markdown');
		expect(resolveStoryStyle({})).toBe('markdown');
	});

	it('honours the admin choice when dbt charts is installed', () => {
		expect(resolveStoryStyle({ stories: { style: 'dbt_charts' } })).toBe('dbt_charts');
		expect(resolveStoryStyle({ stories: { style: 'both' } })).toBe('both');
	});

	it('falls back to markdown when dbt charts is not installed', () => {
		dbtChartsInstalled.value = false;

		expect(resolveStoryStyle({ stories: { style: 'dbt_charts' } })).toBe('markdown');
		expect(resolveStoryStyle({ stories: { style: 'both' } })).toBe('markdown');
	});
});

describe('buildStoryToolDescription', () => {
	it('documents only the markdown syntax for markdown stories', () => {
		const description = buildStoryToolDescription({ storyStyle: 'markdown' });

		expect(description).toContain('<chart query_id=');
		expect(description).toContain('dbt Charts boards are disabled');
		expect(description).not.toContain('skill "dbt-charts"');
	});

	it('makes dbt charts the default and drops the markdown syntax for dbt charts stories', () => {
		const description = buildStoryToolDescription({ storyStyle: 'dbt_charts' });

		expect(description).toContain('format defaults to "dbt_charts"');
		expect(description).toContain('skill "dbt-charts"');
		expect(description).not.toContain('<chart query_id=');
	});

	it('documents both syntaxes when the agent may pick either', () => {
		const description = buildStoryToolDescription({ storyStyle: 'both' });

		expect(description).toContain('<chart query_id=');
		expect(description).toContain('alternatively use format="dbt_charts"');
	});
});
