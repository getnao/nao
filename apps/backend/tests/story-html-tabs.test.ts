import { describe, expect, it } from 'vitest';

import { generateStoryHtml } from '../src/utils/story-html';

describe('generateStoryHtml tabs', () => {
	it('renders each tab as a titled section with its content', () => {
		const html = generateStoryHtml(
			{
				title: 'Tabbed story',
				code: `<tabs>
<tab title="Overview">
## Summary
Hello overview
</tab>
<tab title="Details">
Some details text
</tab>
</tabs>`,
			},
			null,
		);

		expect(html).toContain('Overview');
		expect(html).toContain('Details');
		expect(html).toContain('Hello overview');
		expect(html).toContain('Some details text');
	});
});
