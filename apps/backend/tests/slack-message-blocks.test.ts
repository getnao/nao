import { describe, expect, it } from 'vitest';

import {
	buildSlackCardNotificationText,
	buildSlackTableBlocks,
	chunkSlackText,
	countHiddenTableNotices,
	createCompletionCard,
	createSlackTableRenderState,
	createStopButtonCard,
	createTextBlocks,
	isRecoverableSlackPayloadError,
	SLACK_SECTION_TEXT_MAX_CHARS,
} from '../src/utils/messaging-provider';

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

	it('splits oversized text into Slack-safe sections', () => {
		const blocks = createTextBlocks('x'.repeat(5000));

		expect(blocks.length).toBeGreaterThan(1);
		expect(blocks.every((block) => block.type === 'text')).toBe(true);
		expect(
			blocks.every((block) => block.type !== 'text' || block.content.length <= SLACK_SECTION_TEXT_MAX_CHARS),
		).toBe(true);
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

	it('clamps an oversized cell so it cannot blow Slack table limits', () => {
		const long = 'x'.repeat(500);
		const text = ['| Name | Value |', '|------|-------|', `| row | ${long} |`].join('\n');
		const cell = tableChild(createTextBlocks(text))?.rows[0][1] ?? '';
		expect(cell.length).toBe(300);
		expect(cell.endsWith('…')).toBe(true);
	});

	it("caps table data at 99 rows so Slack's header-inclusive total stays at 100", () => {
		const rows = Array.from({ length: 150 }, (_, i) => `| ${i} |`);
		const blocks = createTextBlocks(['| N |', '|---|', ...rows].join('\n'));
		expect(tableChild(blocks)?.rows).toHaveLength(99);
		expect(blocks[1]).toMatchObject({
			type: 'text',
			content: '_…51 more rows, open in nao_',
			style: 'muted',
		});
	});

	it('shows a muted note by default when rows exceed the total-character budget', () => {
		const cell = 'y'.repeat(200);
		const rows = Array.from({ length: 60 }, () => `| ${cell} | ${cell} |`);
		const blocks = createTextBlocks(['| A | B |', '|---|---|', ...rows].join('\n'));
		const table = tableChild(blocks);
		expect(table).toBeDefined();
		expect(table!.rows.length).toBeLessThan(60);

		const budget = table!.rows.reduce(
			(sum, row) => sum + row.reduce((rowSum, value) => rowSum + Math.max(value.length, 1), 0),
			table!.headers.reduce((sum, value) => sum + Math.max(value.length, 1), 0),
		);
		expect(budget).toBeLessThanOrEqual(9000);

		expect(blocks.some((block) => block.type === 'text' && String(block.content).includes('more rows'))).toBe(true);
		expect(blocks.some((block) => block.type === 'actions')).toBe(false);
	});

	it('shows a muted note by default when columns exceed Slack limits', () => {
		const headers = Array.from({ length: 25 }, (_, index) => `Column ${index + 1}`);
		const values = Array.from({ length: 25 }, (_, index) => String(index + 1));
		const blocks = createTextBlocks(
			[
				`| ${headers.join(' | ')} |`,
				`| ${headers.map(() => '---').join(' | ')} |`,
				`| ${values.join(' | ')} |`,
			].join('\n'),
		);

		expect(tableChild(blocks)?.headers).toHaveLength(20);
		expect(blocks[1]).toMatchObject({
			type: 'text',
			content: '_…5 more columns, open in nao_',
			style: 'muted',
		});
	});

	it('hides notices for a truncated first table and an additional table when requested', () => {
		const rows = Array.from({ length: 150 }, (_, index) => `| ${index} |`);
		const blocks = createTextBlocks(
			['| N |', '|---|', ...rows, '', '| Another |', '|---|', '| value |'].join('\n'),
			{
				truncation: { kind: 'hidden' },
			},
		);

		expect(blocks.map((block) => block.type)).toEqual(['table']);
	});

	it('renders only the first table and notes that another table is omitted', () => {
		const cell = 'z'.repeat(200);
		const firstRows = Array.from({ length: 15 }, () => `| ${cell} | ${cell} |`);
		const secondRows = Array.from({ length: 30 }, () => `| ${cell} | ${cell} |`);
		const text = [
			'| First | Value |',
			'|---|---|',
			...firstRows,
			'',
			'Between tables',
			'',
			'| Second | Value |',
			'|---|---|',
			...secondRows,
		].join('\n');

		const blocks = createTextBlocks(text);
		const tables = blocks.filter((block) => block.type === 'table');

		expect(tables).toHaveLength(1);
		expect(tables[0].rows).toHaveLength(15);
		expect(blocks.map((block) => block.type)).toEqual(['table', 'text', 'text']);
		expect(blocks[2]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
			style: 'muted',
		});
	});

	it('does not inspect a later table before replacing it with a note', () => {
		const oversizedHeaders = Array.from({ length: 20 }, (_, index) => `${index}-${'x'.repeat(300)}`);
		const blocks = createTextBlocks(
			[
				'| First |',
				'|---|',
				'| value |',
				'',
				`| ${oversizedHeaders.join(' | ')} |`,
				`| ${oversizedHeaders.map(() => '---').join(' | ')} |`,
			].join('\n'),
		);

		expect(blocks.map((block) => block.type)).toEqual(['table', 'text']);
		expect(blocks[1]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
			style: 'muted',
		});
	});

	it('adds a linked action immediately after a truncated table and before trailing prose', () => {
		const url = 'https://nao.example/chats/chat-123';
		const headers = Array.from({ length: 25 }, (_, index) => `Column ${index + 1}`);
		const row = Array.from({ length: 25 }, (_, index) => String(index + 1));
		const rows = Array.from({ length: 150 }, () => `| ${row.join(' | ')} |`);
		const blocks = createTextBlocks(
			[
				'Here are the results.',
				'',
				`| ${headers.join(' | ')} |`,
				`| ${headers.map(() => '---').join(' | ')} |`,
				...rows,
				'',
				'Additional commentary after the table.',
			].join('\n'),
			{ truncation: { kind: 'link', url } },
		);
		const table = tableChild(blocks);
		const actions = blocks.filter((block) => block.type === 'actions');

		expect(blocks.map((block) => block.type)).toEqual(['text', 'table', 'actions', 'text']);
		expect(blocks[3]).toMatchObject({ content: 'Additional commentary after the table.' });
		expect(table?.headers).toHaveLength(20);
		expect(table?.rows[0]).toHaveLength(20);
		expect(table?.rows).toHaveLength(99);
		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({
			type: 'actions',
			children: [
				{
					type: 'link-button',
					url,
					label: 'Open in nao to see full table',
				},
			],
		});
	});

	it('uses one truncation button and a placeholder for an omitted second table', () => {
		const url = 'https://nao.example/chats/chat-123';
		const firstHeaders = Array.from({ length: 21 }, (_, index) => `Column ${index + 1}`);
		const firstRow = Array.from({ length: 21 }, (_, index) => String(index + 1));
		const secondRows = Array.from({ length: 101 }, (_, index) => `| ${index + 1} |`);
		const blocks = createTextBlocks(
			[
				`| ${firstHeaders.join(' | ')} |`,
				`| ${firstHeaders.map(() => '---').join(' | ')} |`,
				`| ${firstRow.join(' | ')} |`,
				'',
				'| Value |',
				'|---|',
				...secondRows,
			].join('\n'),
			{ truncation: { kind: 'link', url } },
		);
		const actions = blocks.filter((block) => block.type === 'actions');

		expect(blocks.map((block) => block.type)).toEqual(['table', 'actions', 'text']);
		expect(blocks.filter((block) => block.type === 'table')).toHaveLength(1);
		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({
			type: 'actions',
			children: [{ type: 'link-button', url, label: 'Open in nao to see full table', style: undefined }],
		});
		expect(blocks[2]).toMatchObject({
			type: 'text',
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
			style: 'muted',
		});
	});

	it('keeps consecutive omitted tables as separately numbered placeholders', () => {
		const url = 'https://nao.example/chats/chat-123';
		const blocks = createTextBlocks(
			[
				'| First |',
				'|---|',
				'| value |',
				'',
				'| Second |',
				'|---|',
				'| value |',
				'',
				'| Third |',
				'|---|',
				'| value |',
			].join('\n'),
			{ truncation: { kind: 'link', url } },
		);

		expect(blocks.map((block) => block.type)).toEqual(['table', 'text', 'text']);
		expect(blocks[1]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
			style: 'muted',
		});
		expect(blocks[2]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 3 ]*',
			style: 'muted',
		});
	});

	it('keeps numbered placeholders in position around prose', () => {
		const url = 'https://nao.example/chats/chat-123';
		const blocks = createTextBlocks(
			[
				'| First |',
				'|---|',
				'| value |',
				'',
				'| Second |',
				'|---|',
				'| value |',
				'',
				'Between the additional tables.',
				'',
				'| Third |',
				'|---|',
				'| value |',
			].join('\n'),
			{ truncation: { kind: 'link', url } },
		);

		expect(blocks.map((block) => block.type)).toEqual(['table', 'text', 'text', 'text']);
		expect(blocks[1]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
			style: 'muted',
		});
		expect(blocks[2]).toMatchObject({ content: 'Between the additional tables.' });
		expect(blocks[3]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 3 ]*',
			style: 'muted',
		});
	});

	it('shares native table selection and hidden table counting across calls', () => {
		const tableState = createSlackTableRenderState();
		const firstBlocks = createTextBlocks('| First |\n|---|\n| value |', { tableState });
		const secondBlocks = createTextBlocks('| Second |\n|---|\n| value |', { tableState });

		expect(firstBlocks.map((block) => block.type)).toEqual(['table']);
		expect(secondBlocks.map((block) => block.type)).toEqual(['text']);
		expect(secondBlocks[0]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
			style: 'muted',
		});
		expect(countHiddenTableNotices([...firstBlocks, ...secondBlocks])).toBe(1);
	});

	it('restores a table-only hidden run when rendering the final message', () => {
		const firstTable = '| First |\n|---|\n| value |';
		const secondTable = '| Second |\n|---|\n| value |';
		const streamingTableState = createSlackTableRenderState();

		createTextBlocks(firstTable, {
			truncation: { kind: 'hidden' },
			tableState: streamingTableState,
		});
		const streamingBlocks = createTextBlocks(secondTable, {
			truncation: { kind: 'hidden' },
			tableState: streamingTableState,
		});

		expect(streamingBlocks).toEqual([]);
		expect(streamingTableState.tableNumber).toBe(2);

		const finalTableState = createSlackTableRenderState();
		const finalBlocks = [
			...createTextBlocks(firstTable, {
				truncation: { kind: 'link', url: 'https://nao.example' },
				tableState: finalTableState,
			}),
			...createTextBlocks(secondTable, {
				truncation: { kind: 'link', url: 'https://nao.example' },
				tableState: finalTableState,
			}),
		];

		expect(finalBlocks.map((block) => block.type)).toEqual(['table', 'text']);
		expect(finalBlocks[1]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
			style: 'muted',
		});
		expect(countHiddenTableNotices(finalBlocks)).toBe(1);
	});

	it('continues hidden table numbering across calls', () => {
		const tableState = createSlackTableRenderState();
		createTextBlocks('| First |\n|---|\n| value |', { tableState });
		const secondBlocks = createTextBlocks('| Second |\n|---|\n| value |', { tableState });
		const thirdBlocks = createTextBlocks('| Third |\n|---|\n| value |', { tableState });

		expect(secondBlocks[0]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
		});
		expect(thirdBlocks[0]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 3 ]*',
		});
	});

	it('shares the table character budget across calls', () => {
		const tableState = createSlackTableRenderState();
		const cell = 'x'.repeat(80);
		const rows = Array.from({ length: 50 }, () => `| ${cell} | ${cell} |`);
		const firstBlocks = createTextBlocks(['| A | B |', '|---|---|', ...rows].join('\n'), { tableState });
		const secondBlocks = createTextBlocks('| Second |\n|---|\n| value |', { tableState });

		expect(tableState.remainingTableChars).toBeLessThan(1000);
		expect(firstBlocks.filter((block) => block.type === 'table')).toHaveLength(1);
		expect(secondBlocks.filter((block) => block.type === 'table')).toHaveLength(0);
		expect(secondBlocks[0]).toMatchObject({
			content: '\u00a0\u00a0\u00a0\u00a0*[ Table 2 ]*',
		});
	});

	it('uses independent table state when none is provided', () => {
		const firstBlocks = createTextBlocks('| First |\n|---|\n| value |');
		const secondBlocks = createTextBlocks('| Second |\n|---|\n| value |');

		expect(firstBlocks.filter((block) => block.type === 'table')).toHaveLength(1);
		expect(secondBlocks.filter((block) => block.type === 'table')).toHaveLength(1);
	});
});

describe('countHiddenTableNotices', () => {
	it('counts omitted table placeholders in rendered children', () => {
		const children = createTextBlocks(
			[
				'| First |',
				'|---|',
				'| value |',
				'',
				'| Second |',
				'|---|',
				'| value |',
				'',
				'| Third |',
				'|---|',
				'| value |',
			].join('\n'),
		);

		expect(countHiddenTableNotices(children)).toBe(2);
	});

	it('returns zero when no tables are omitted', () => {
		expect(countHiddenTableNotices(createTextBlocks('No omitted tables.'))).toBe(0);
		expect(countHiddenTableNotices(createTextBlocks('| Only | table |\n|---|---|\n| one | value |'))).toBe(0);
	});
});

describe('createCompletionCard', () => {
	it.each([
		[0, 'Open in nao'],
		[1, 'Open the other table in nao'],
		[3, 'Open the other 3 tables in nao'],
	])('labels the link for %i hidden tables', (hiddenTables, label) => {
		const card = createCompletionCard('https://nao.example/chats/chat-123', undefined, hiddenTables);

		expect(card.children[0]).toMatchObject({
			type: 'actions',
			children: [
				{ type: 'link-button', label },
				{ type: 'button', id: 'feedback_positive' },
				{ type: 'button', id: 'feedback_negative' },
			],
		});
		const actions = card.children[0];
		if (actions.type !== 'actions') {
			throw new Error('Expected completion card actions');
		}
		if (hiddenTables === 0) {
			expect('style' in actions.children[0] ? actions.children[0].style : undefined).toBeUndefined();
		} else {
			expect(actions.children[0]).toHaveProperty('style', 'primary');
		}
	});
});

describe('Slack payload safety', () => {
	it('builds non-empty notification text for table-only cards', () => {
		const children = createTextBlocks(['| Name | Value |', '|---|---|', '| Alpha | 123 |'].join('\n'));

		const text = buildSlackCardNotificationText(children);

		expect(text).toBe('Results table (open in nao for full data)');
	});

	it('keeps table notification text short without dumping table rows', () => {
		const rows = Array.from({ length: 100 }, (_, index) => `| secret-row-${index} | ${'x'.repeat(200)} |`);
		const children = createTextBlocks(
			['Here are the results.', '| Name | Value |', '|---|---|', ...rows].join('\n'),
		);

		const text = buildSlackCardNotificationText(children);

		expect(text).toContain('Here are the results.');
		expect(text).toContain('Results table (open in nao for full data)');
		expect(text).not.toContain('secret-row-99');
		expect(text.length).toBeLessThanOrEqual(1000);
	});

	it('builds non-empty notification text for actions-only cards', () => {
		const text = buildSlackCardNotificationText(
			createCompletionCard('https://nao.example/chats/chat-123').children,
		);

		expect(text).toBe('nao answer');
	});

	it('renders the stop button without placeholder text', () => {
		const card = createStopButtonCard();

		expect(card.children).toHaveLength(1);
		expect(card.children[0]).toMatchObject({
			type: 'actions',
			children: [{ id: 'stop_generation' }],
		});
	});

	it('splits oversized replies into safe Slack chunks', () => {
		const chunks = chunkSlackText('A long answer '.repeat(400), SLACK_SECTION_TEXT_MAX_CHARS);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= SLACK_SECTION_TEXT_MAX_CHARS)).toBe(true);
		expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
	});

	it('keeps replies below the Slack message limit in one chunk', () => {
		const text = 'x'.repeat(SLACK_SECTION_TEXT_MAX_CHARS - 1);
		const chunks = chunkSlackText(text, SLACK_SECTION_TEXT_MAX_CHARS);

		expect(chunks).toEqual([text]);
	});

	it('recognizes recoverable Slack payload errors', () => {
		expect(isRecoverableSlackPayloadError({ data: { error: 'msg_too_long' } })).toBe(true);
		expect(isRecoverableSlackPayloadError(new Error('invalid_blocks'))).toBe(true);
		expect(isRecoverableSlackPayloadError({ data: { error: 'ratelimited' } })).toBe(false);
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

	it("keeps the rendered table block within Slack's 10,000-character budget", () => {
		const bigRows = Array.from({ length: 200 }, (_, i) => `| item ${i} | ${'x'.repeat(120)} |`);
		const text = ['| Name | Description |', '|------|-------------|', ...bigRows].join('\n');

		const blocks = buildSlackTableBlocks(text) as AnyBlock[] | null;
		const tableBlock = blocks?.find((block) => block.type === 'table') as
			| { rows: { type: string; text: string }[][] }
			| undefined;
		expect(tableBlock).toBeDefined();

		const totalChars = tableBlock!.rows.reduce(
			(sum, row) => sum + row.reduce((rowSum, cell) => rowSum + cell.text.length, 0),
			0,
		);
		expect(totalChars).toBeLessThanOrEqual(10_000);
	});

	it('keeps every rendered section within Slack limits when a message has two tables', () => {
		const firstTable = ['| Name | Value |', '|---|---|', '| First | 1 |'];
		const secondRows = Array.from({ length: 40 }, (_, index) => `| row-${index} | ${'long value '.repeat(12)} |`);
		const text = [...firstTable, '', '| Second | Description |', '|---|---|', ...secondRows].join('\n');

		const blocks = buildSlackTableBlocks(text) as AnyBlock[] | null;
		const tableBlocks = blocks?.filter((block) => block.type === 'table') ?? [];
		const sectionBlocks = (blocks?.filter((block) => block.type === 'section') ?? []) as {
			type: 'section';
			text?: { text: string };
		}[];

		expect(tableBlocks).toHaveLength(1);
		expect(sectionBlocks.every((block) => (block.text?.text.length ?? 0) <= 3000)).toBe(true);
	});
});
