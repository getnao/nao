import React from 'react';
import { describe, expect, it } from 'vitest';

import { renderToMarkdown } from '../src/lib/markdown';
import * as md from '../src/lib/markdown/components';

describe('renderToMarkdown', () => {
	it('renders a simple title', () => {
		expect(renderToMarkdown(<md.Title level={1}>Hello, world!</md.Title>)).toBe('# Hello, world!');
	});

	it('renders titles at every level', () => {
		expect(renderToMarkdown(<md.Title level={2}>Level 2</md.Title>)).toBe('## Level 2');
		expect(renderToMarkdown(<md.Title level={3}>Level 3</md.Title>)).toBe('### Level 3');
		expect(renderToMarkdown(<md.Title level={4}>Level 4</md.Title>)).toBe('#### Level 4');
		expect(renderToMarkdown(<md.Title level={5}>Level 5</md.Title>)).toBe('##### Level 5');
		expect(renderToMarkdown(<md.Title level={6}>Level 6</md.Title>)).toBe('###### Level 6');
	});

	it('renders default title level (2)', () => {
		expect(renderToMarkdown(<md.Title>Default</md.Title>)).toBe('## Default');
	});

	it('renders a span as plain text', () => {
		expect(renderToMarkdown(<md.Span>Just text</md.Span>)).toBe('Just text');
	});

	it('renders bold text', () => {
		expect(renderToMarkdown(<md.Bold>strong</md.Bold>)).toBe('**strong**');
	});

	it('renders italic text', () => {
		expect(renderToMarkdown(<md.Italic>emphasis</md.Italic>)).toBe('*emphasis*');
	});

	it('renders inline code', () => {
		expect(renderToMarkdown(<md.Code>SELECT 1</md.Code>)).toBe('`SELECT 1`');
	});

	it('renders a code block without header', () => {
		expect(renderToMarkdown(<md.CodeBlock>console.log("hi")</md.CodeBlock>)).toBe('```\nconsole.log("hi")\n```');
	});

	it('renders a code block with a string header', () => {
		expect(renderToMarkdown(<md.CodeBlock header='sql'>SELECT * FROM users</md.CodeBlock>)).toBe(
			'```sql\nSELECT * FROM users\n```',
		);
	});

	it('renders a code block with an array header', () => {
		expect(renderToMarkdown(<md.CodeBlock header={['sql', 'title=query']}>SELECT 1</md.CodeBlock>)).toBe(
			'```sql title=query\nSELECT 1\n```',
		);
	});

	it('renders a link', () => {
		expect(renderToMarkdown(<md.Link href='https://example.com' text='Example' />)).toBe(
			'[Example](https://example.com)',
		);
	});

	it('renders a line break', () => {
		expect(renderToMarkdown(<md.Br />)).toBe('\n');
	});

	it('renders a horizontal rule', () => {
		expect(renderToMarkdown(<md.Hr />)).toBe('---');
	});

	it('renders an unordered list', () => {
		const result = renderToMarkdown(
			<md.List>
				<md.ListItem>Apples</md.ListItem>
				<md.ListItem>Bananas</md.ListItem>
				<md.ListItem>Cherries</md.ListItem>
			</md.List>,
		);
		expect(result).toBe('- Apples\n- Bananas\n- Cherries');
	});

	it('renders an ordered list', () => {
		const result = renderToMarkdown(
			<md.List ordered>
				<md.ListItem>First</md.ListItem>
				<md.ListItem>Second</md.ListItem>
				<md.ListItem>Third</md.ListItem>
			</md.List>,
		);
		expect(result).toBe('1. First\n2. Second\n3. Third');
	});

	it('renders nested lists', () => {
		const result = renderToMarkdown(
			<md.List>
				<md.ListItem>Parent A</md.ListItem>
				<md.List>
					<md.ListItem>Child A1</md.ListItem>
					<md.ListItem>Child A2</md.ListItem>
				</md.List>
				<md.ListItem>Parent B</md.ListItem>
			</md.List>,
		);
		expect(result).toBe('- Parent A\n\t- Child A1\n\t- Child A2\n- Parent B');
	});

	it('renders a single-item list', () => {
		const result = renderToMarkdown(
			<md.List>
				<md.ListItem>Only item</md.ListItem>
			</md.List>,
		);
		expect(result).toBe('- Only item');
	});

	it('renders a titled list', () => {
		const result = renderToMarkdown(
			<md.TitledList title='Fruits'>
				<md.ListItem>Apple</md.ListItem>
				<md.ListItem>Banana</md.ListItem>
			</md.TitledList>,
		);
		expect(result).toBe('Fruits:\n- Apple\n- Banana');
	});

	it('renders a titled list with maxItems truncation', () => {
		const result = renderToMarkdown(
			<md.TitledList title='Colors' maxItems={2}>
				<md.ListItem>Red</md.ListItem>
				<md.ListItem>Green</md.ListItem>
				<md.ListItem>Blue</md.ListItem>
				<md.ListItem>Yellow</md.ListItem>
			</md.TitledList>,
		);
		expect(result).toBe('Colors:\n- Red\n- Green\n...(2 more)');
	});

	it('renders a block with multiple children separated by double newlines', () => {
		const result = renderToMarkdown(
			<md.Block>
				<md.Title level={1}>Report</md.Title>
				<md.Span>Some introductory text here.</md.Span>
				<md.Hr />
				<md.Span>Footer text.</md.Span>
			</md.Block>,
		);
		expect(result).toBe('# Report\n\nSome introductory text here.\n\n---\n\nFooter text.');
	});

	it('renders a block with custom separator', () => {
		const result = renderToMarkdown(
			<md.Block separator=' | '>
				<md.Span>A</md.Span>
				<md.Span>B</md.Span>
				<md.Span>C</md.Span>
			</md.Block>,
		);
		expect(result).toBe('A | B | C');
	});

	it('renders nested blocks', () => {
		const result = renderToMarkdown(
			<md.Block>
				<md.Title level={2}>Section</md.Title>
				<md.Block separator={'\n'}>
					<md.Span>Line 1</md.Span>
					<md.Span>Line 2</md.Span>
				</md.Block>
			</md.Block>,
		);
		expect(result).toBe('## Section\n\nLine 1\nLine 2');
	});

	it('renders bold inside a title', () => {
		const result = renderToMarkdown(
			<md.Title level={2}>
				Results for <md.Bold>Q4</md.Bold>
			</md.Title>,
		);
		expect(result).toBe('## Results for **Q4**');
	});

	it('renders a link inside bold text', () => {
		const result = renderToMarkdown(
			<md.Bold>
				<md.Link href='https://example.com' text='click here' />
			</md.Bold>,
		);
		expect(result).toBe('**[click here](https://example.com)**');
	});

	it('renders inline code inside italic', () => {
		const result = renderToMarkdown(
			<md.Italic>
				uses <md.Code>useState</md.Code> hook
			</md.Italic>,
		);
		expect(result).toBe('*uses `useState` hook*');
	});

	it('renders a complex document with mixed components', () => {
		const result = renderToMarkdown(
			<md.Block>
				<md.Title level={1}>Sales Report</md.Title>
				<md.Span>
					Generated on <md.Bold>2026-02-11</md.Bold> by <md.Italic>analytics-bot</md.Italic>.
				</md.Span>
				<md.CodeBlock header='sql'>SELECT region, SUM(revenue) FROM sales GROUP BY region</md.CodeBlock>
				<md.TitledList title='Top products'>
					<md.ListItem>Widget A</md.ListItem>
					<md.ListItem>Widget B</md.ListItem>
					<md.ListItem>Widget C</md.ListItem>
				</md.TitledList>
				<md.Hr />
				<md.Span>
					See <md.Link href='https://dashboard.example.com' text='full dashboard' /> for details.
				</md.Span>
			</md.Block>,
		);

		expect(result).toBe(
			'# Sales Report\n\n' +
				'Generated on **2026-02-11** by *analytics-bot*.\n\n' +
				'```sql\nSELECT region, SUM(revenue) FROM sales GROUP BY region\n```\n\n' +
				'Top products:\n- Widget A\n- Widget B\n- Widget C\n\n' +
				'---\n\n' +
				'See [full dashboard](https://dashboard.example.com) for details.',
		);
	});

	it('renders numbers as strings', () => {
		expect(renderToMarkdown(<md.Span>{42}</md.Span>)).toBe('42');
	});

	it('skips null and boolean children', () => {
		const result = renderToMarkdown(
			<md.Block>
				{null}
				{false}
				{true}
				<md.Span>visible</md.Span>
				{undefined}
			</md.Block>,
		);
		expect(result).toBe('visible');
	});

	it('renders deeply nested formatting', () => {
		const result = renderToMarkdown(
			<md.Bold>
				<md.Italic>
					<md.Code>deep</md.Code>
				</md.Italic>
			</md.Bold>,
		);
		expect(result).toBe('***`deep`***');
	});

	it('renders a list with formatted items', () => {
		const result = renderToMarkdown(
			<md.List>
				<md.ListItem>
					<md.Bold>Important</md.Bold> — do this first
				</md.ListItem>
				<md.ListItem>
					Run <md.Code>npm install</md.Code>
				</md.ListItem>
				<md.ListItem>
					Visit <md.Link href='https://docs.example.com' text='the docs' />
				</md.ListItem>
			</md.List>,
		);
		expect(result).toBe(
			'- **Important** — do this first\n- Run `npm install`\n- Visit [the docs](https://docs.example.com)',
		);
	});

	it('renders an empty block', () => {
		expect(renderToMarkdown(<md.Block>{null}</md.Block>)).toBe('');
	});

	it('renders a block with a single child', () => {
		expect(
			renderToMarkdown(
				<md.Block>
					<md.Span>only child</md.Span>
				</md.Block>,
			),
		).toBe('only child');
	});

	it('handles plain string input', () => {
		expect(renderToMarkdown('just a string')).toBe('just a string');
	});

	it('handles number input', () => {
		expect(renderToMarkdown(99)).toBe('99');
	});

	it('handles null input', () => {
		expect(renderToMarkdown(null)).toBe('');
	});
});
