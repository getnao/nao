import { describe, expect, it } from 'vitest';

import { storySnapshotHtml } from '../src/utils/custom-story-trpc';
import { MAX_STORY_SNAPSHOT_BYTES } from '../src/utils/story-snapshot';

describe('storySnapshotHtml', () => {
	it('accepts a snapshot at the byte limit', () => {
		expect(storySnapshotHtml.safeParse('a'.repeat(MAX_STORY_SNAPSHOT_BYTES)).success).toBe(true);
	});

	it('counts bytes, so multi-byte characters under the character limit can exceed it', () => {
		const html = 'é'.repeat(MAX_STORY_SNAPSHOT_BYTES / 2 + 1);

		expect(html.length).toBeLessThan(MAX_STORY_SNAPSHOT_BYTES);
		expect(storySnapshotHtml.safeParse(html).success).toBe(false);
	});
});
