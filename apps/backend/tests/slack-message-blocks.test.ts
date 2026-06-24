import { describe, expect, it } from 'vitest';

import { buildSlackTableBlocks, createTextBlocks } from '../src/utils/messaging-provider';

type AnyBlock = { type: string; [key: string]: unknown };

function tableChild(blocks: ReturnType<typeof createTextBlocks>) {
	return blocks.find((block) => block.type === 'table') as
		| { type: 'table'; headers: string[]; rows: string[][] }
		| undefined;
}

describe('createTextBlocks', () => {
	it('returns a single text block when there is no table', () => {
		const blocks = createTextBlocks('Just a plain answer with **bold**.');
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({ type: 'text', content: 'Just a plain answer with *bold*.' });
	});

	it('splits a markdown table into a Table element with text around it', () => {
		const text = [
			'Here is your table:',
			'',
			'| Column A | Column B |',
			'|----------|----------|',
			'| Hello | World |',
			'| Foo | Bar |',
			'',
			'Let me know!',
		].join('\n');

		const blocks = createTextBlocks(text);

		expect(blocks.map((block) => block.type)).toEqual(['text', 'table', 'text']);
		expect(tableChild(blocks)).toEqual({
			type: 'table',
			headers: ['Column A', 'Column B'],
			rows: [
				['Hello', 'World'],
				['Foo', 'Bar'],
			],
		});
		expect(blocks[0]).toMatchObject({ content: 'Here is your table:' });
		expect(blocks[2]).toMatchObject({ content: 'Let me know!' });
	});

	it('handles tables without outer pipes and alignment markers', () => {
		const text = ['Revenue | Region', ':---|---:', 'Hello | World'].join('\n');
		const table = tableChild(createTextBlocks(text));
		expect(table).toEqual({
			type: 'table',
			headers: ['Revenue', 'Region'],
			rows: [['Hello', 'World']],
		});
	});

	it('strips inline markdown and links inside table cells', () => {
		const text = ['| Name | Link |', '|------|------|', '| **Bob** | [docs](https://x.dev) |'].join('\n');
		const table = tableChild(createTextBlocks(text));
		expect(table?.rows).toEqual([['Bob', 'docs']]);
	});

	it('pads and truncates rows to match the header column count', () => {
		const text = ['| A | B | C |', '|---|---|---|', '| 1 | 2 |', '| 1 | 2 | 3 | 4 |'].join('\n');
		const table = tableChild(createTextBlocks(text));
		expect(table?.rows).toEqual([
			['1', '2', ''],
			['1', '2', '3'],
		]);
	});

	it('does not treat pipe tables inside fenced code blocks as tables', () => {
		const text = ['```', '| A | B |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
		const blocks = createTextBlocks(text);
		expect(blocks.map((block) => block.type)).toEqual(['text']);
		expect(tableChild(blocks)).toBeUndefined();
	});

	it('keeps a mismatched fence marker as literal content inside a code block', () => {
		const text = ['```', '~~~', '| A | B |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
		const blocks = createTextBlocks(text);
		expect(blocks.map((block) => block.type)).toEqual(['text']);
		expect(tableChild(blocks)).toBeUndefined();
	});

	it('parses a real table that follows a closed code block', () => {
		const text = ['```', 'code', '```', '', '| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
		const table = tableChild(createTextBlocks(text));
		expect(table).toEqual({
			type: 'table',
			headers: ['A', 'B'],
			rows: [['1', '2']],
		});
	});
});

describe('buildSlackTableBlocks', () => {
	it('returns null when the message contains no table', () => {
		expect(buildSlackTableBlocks('No tables here, just text.')).toBeNull();
	});

	it('builds an official Slack table block from a markdown table', () => {
		const text = ['| Column A | Column B |', '|----------|----------|', '| Hello | World |', '| Foo | Bar |'].join(
			'\n',
		);

		const blocks = buildSlackTableBlocks(text) as AnyBlock[] | null;
		expect(blocks).not.toBeNull();

		const tableBlock = blocks!.find((block) => block.type === 'table') as
			| { type: 'table'; rows: { type: string; text: string }[][] }
			| undefined;
		expect(tableBlock).toBeDefined();
		expect(tableBlock!.rows).toEqual([
			[
				{ type: 'raw_text', text: 'Column A' },
				{ type: 'raw_text', text: 'Column B' },
			],
			[
				{ type: 'raw_text', text: 'Hello' },
				{ type: 'raw_text', text: 'World' },
			],
			[
				{ type: 'raw_text', text: 'Foo' },
				{ type: 'raw_text', text: 'Bar' },
			],
		]);
	});
});
