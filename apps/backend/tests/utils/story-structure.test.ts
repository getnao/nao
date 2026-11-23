import {
	prepareRestrictedStoryCode,
	STORY_VIEWER_RESTRICTED_CODE_MARKER,
	VIEWER_NARRATIVE_PLACEHOLDER,
	VIEWER_SECTION_PLACEHOLDER,
} from '@nao/shared/story-viewer-restrictions';
import { describe, expect, it } from 'vitest';

import {
	buildViewerSafeStorySource,
	extractStructureTokens,
	stripHardcodedFilterOptions,
} from '../../src/utils/story-structure';

const OWNER_CODE = [
	'## EMEA revenue hit 5M',
	'EMEA grew fastest this quarter.',
	'',
	`<chart query_id="q_revenue" title="EMEA revenue" series='[{"data_key":"net_revenue","label":"EMEA net"}]' />`,
	`<filter id="region" type="select" options='["EMEA","APAC"]' />`,
].join('\n');

describe('buildViewerSafeStorySource', () => {
	it('keeps the structure and replaces every piece of owner copy', () => {
		const safeSource = buildViewerSafeStorySource(OWNER_CODE);

		expect(safeSource.split('\n')).toEqual([
			STORY_VIEWER_RESTRICTED_CODE_MARKER,
			`## ${VIEWER_SECTION_PLACEHOLDER}`,
			VIEWER_NARRATIVE_PLACEHOLDER,
			'',
			`<chart query_id="q_revenue" series='[{"data_key":"net_revenue","label":"Net Revenue"}]' />`,
			'<filter id="region" type="select" />',
		]);
		expect(safeSource).not.toContain('EMEA');
	});

	it('leaves only the blocks once the placeholders nothing rewrote are removed', () => {
		expect(prepareRestrictedStoryCode(buildViewerSafeStorySource(OWNER_CODE))).toEqual({
			code: [
				`<chart query_id="q_revenue" series='[{"data_key":"net_revenue","label":"Net Revenue"}]' />`,
				'<filter id="region" type="select" />',
			].join('\n'),
			hasRestrictedContent: true,
		});
	});
});

describe('extractStructureTokens', () => {
	it('lists the block tags of a story in order', () => {
		expect(extractStructureTokens('Intro\n<grid cols="2">\n<table query_id="q_orders" />\n</grid>')).toEqual([
			'<grid cols="2">',
			'<table query_id="q_orders" />',
			'</grid>',
		]);
	});
});

describe('stripHardcodedFilterOptions', () => {
	it('drops the options listed on filter tags and nothing else', () => {
		expect(
			stripHardcodedFilterOptions(
				`Regions\n<filter id="region" type="select" options='["EMEA","APAC"]' />\n<table query_id="q" />`,
			),
		).toBe('Regions\n<filter id="region" type="select" />\n<table query_id="q" />');
	});
});
