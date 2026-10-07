import { describe, expect, it } from 'vitest';

import { buildCustomStoryToolResult } from '../src/mcp/embed/embed-tool-result';

describe('buildCustomStoryToolResult', () => {
	const result = buildCustomStoryToolResult({
		id: 'story-1',
		title: 'Revenue Simulator',
		url: 'http://localhost:3000/stories/story-1',
		chatUrl: 'http://localhost:3000/chat-1',
	});

	it('returns the nao link without an embed', () => {
		expect(result.structuredContent).toEqual({
			id: 'story-1',
			title: 'Revenue Simulator',
			url: 'http://localhost:3000/stories/story-1',
			chatUrl: 'http://localhost:3000/chat-1',
			format: 'custom',
		});
		expect(result.structuredContent).not.toHaveProperty('embedUrl');
		expect(result.structuredContent).not.toHaveProperty('sandboxStoryHtml');
	});

	it('gives the client a markdown link to share', () => {
		const texts = result.content.map((block) => (block.type === 'text' ? block.text : ''));
		expect(texts).toContain('**Revenue Simulator**\n\n[Open in nao](http://localhost:3000/stories/story-1)');
	});
});
