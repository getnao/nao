import { describe, expect, it } from 'vitest';

import { getLatestToolActivityLabel } from './tool-activity';
import type { GroupablePart } from '@/types/ai';

const toolPart = (
	toolName: string,
	input: Record<string, unknown> | undefined,
	state: 'input-streaming' | 'input-available' | 'output-available' = 'input-available',
): GroupablePart =>
	({
		type: `tool-${toolName}`,
		toolCallId: `${toolName}-call`,
		state,
		input,
		output: {},
	}) as unknown as GroupablePart;

const dynamicToolPart = (toolName: string, input: Record<string, unknown>): GroupablePart =>
	({
		type: 'dynamic-tool',
		toolName,
		toolCallId: `${toolName}-call`,
		state: 'input-available',
		input,
	}) as unknown as GroupablePart;

const reasoning = (state: 'streaming' | 'done'): GroupablePart =>
	({ type: 'reasoning', text: 'thinking', state }) as GroupablePart;

describe('getLatestToolActivityLabel', () => {
	it('names the file being read and where it comes from, like the read row does', () => {
		expect(
			getLatestToolActivityLabel([
				toolPart('read', {
					file_path: '/databases/type=duckdb/schema=prod_silver/table=fct_sales_opportunities/columns.md',
				}),
			]),
		).toBe('Exploring columns.md from prod_silver.fct_sales_opportunities');
		expect(getLatestToolActivityLabel([toolPart('read', { file_path: 'RULES.md' })])).toBe('Exploring RULES.md');
	});

	it('names the MCP tool in use', () => {
		expect(getLatestToolActivityLabel([dynamicToolPart('mcp_call', { server: 'metabase', tool: 'query' })])).toBe(
			'Using query from metabase',
		);
		expect(getLatestToolActivityLabel([toolPart('read', { file_path: '/agent/mcps/metabase/query.json' })])).toBe(
			'Loading query from metabase',
		);
	});

	it('follows the last tool call, ignoring reasoning', () => {
		const parts = [
			toolPart('read', { file_path: 'a.sql' }, 'output-available'),
			toolPart('read', { file_path: 'b.sql' }),
			reasoning('streaming'),
		];

		expect(getLatestToolActivityLabel(parts)).toBe('Exploring b.sql');
		expect(getLatestToolActivityLabel([toolPart('read', { file_path: 'a.sql' }, 'output-available')])).toBe(
			'Exploring a.sql',
		);
	});

	it('prefers the newest call still running when parallel calls settle out of order', () => {
		const parts = [
			toolPart('read', { file_path: 'slow.sql' }, 'input-available'),
			toolPart('read', { file_path: 'fast.sql' }, 'output-available'),
		];

		expect(getLatestToolActivityLabel(parts)).toBe('Exploring slow.sql');
	});

	it('returns null when no tool has run or the latest input is not yet known', () => {
		expect(getLatestToolActivityLabel([toolPart('read', undefined, 'input-streaming')])).toBeNull();
		expect(getLatestToolActivityLabel([reasoning('streaming')])).toBeNull();
	});
});
