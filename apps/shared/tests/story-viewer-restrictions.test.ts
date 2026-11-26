import { describe, expect, it } from 'vitest';

import { prepareRestrictedStoryCode, STORY_VIEWER_RESTRICTED_CODE_MARKER } from '../src/story-viewer-restrictions';

describe('restricted shared story copy', () => {
	it('replaces backend placeholders with a single frontend access state', () => {
		expect(
			prepareRestrictedStoryCode(
				[
					STORY_VIEWER_RESTRICTED_CODE_MARKER,
					'Viewer-specific narrative.',
					'## Viewer-specific section',
					'<chart query_id="query_customers" />',
					'### Viewer-specific section <table query_id="query_orders" />',
				].join('\n'),
			),
		).toEqual({
			code: '<chart query_id="query_customers" />\n<table query_id="query_orders" />',
			hasRestrictedContent: true,
		});
	});

	it('leaves normal story copy unchanged', () => {
		const code = '## Customers\nCustomer revenue summary.\n<chart query_id="query_customers" />';
		expect(prepareRestrictedStoryCode(code)).toEqual({ code, hasRestrictedContent: false });
	});

	it('preserves authored placeholder copy and whitespace without the internal marker', () => {
		const code = '\nViewer-specific narrative.\n\n\n## Viewer-specific section\n';
		expect(prepareRestrictedStoryCode(code)).toEqual({ code, hasRestrictedContent: false });
	});
});
