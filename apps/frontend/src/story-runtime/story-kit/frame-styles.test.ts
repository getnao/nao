import { STORY_FRAME_CONTAINER } from '@nao/shared/story-app';
import { describe, expect, it } from 'vitest';

import { rebaseCssOnFrame } from './frame-styles';

describe('rebaseCssOnFrame', () => {
	it('rebases range queries whichever side the dimension is on', () => {
		expect(rebaseCssOnFrame('@media (600px < width) {}')).toBe(
			`@container ${STORY_FRAME_CONTAINER} (600px < width) {}`,
		);
		expect(rebaseCssOnFrame('@media (400px <= width <= 900px) {}')).toBe(
			`@container ${STORY_FRAME_CONTAINER} (400px <= width <= 900px) {}`,
		);
	});

	it('leaves unit-like text in strings, urls and comments untouched', () => {
		const css = ".a::after { content: '50vw'; background: url(/img/10vh.png); } /* 100vh */ .b { height: 100vh; }";

		expect(rebaseCssOnFrame(css)).toBe(
			".a::after { content: '50vw'; background: url(/img/10vh.png); } /* 100vh */ .b { height: 100cqh; }",
		);
	});
});
