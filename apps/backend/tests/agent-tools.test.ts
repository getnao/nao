import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { getTools } from '../src/agents/tools';

describe('getTools excludeBuiltinTools', () => {
	it('includes display_map by default', () => {
		expect(getTools(null)).toHaveProperty('display_map');
	});

	it('drops excluded tools and keeps the rest', () => {
		const tools = getTools(null, undefined, { excludeBuiltinTools: ['display_map'] });
		expect(tools).not.toHaveProperty('display_map');
		expect(tools).toHaveProperty('display_chart');
		expect(tools).toHaveProperty('execute_sql');
	});

	it('applies the exclusion after the allowlist', () => {
		const tools = getTools(null, undefined, {
			builtinToolAllowlist: ['execute_sql', 'display_map'],
			excludeBuiltinTools: ['display_map'],
		});
		expect(Object.keys(tools)).toEqual(['execute_sql']);
	});

	it('keeps extra tools that are not excluded', () => {
		const extra = { my_tool: {} };
		const tools = getTools(null, extra, { excludeBuiltinTools: ['display_map'] });
		expect(tools).toHaveProperty('my_tool');
	});

	it('never drops extra tools, even when their name is in the exclusion list', () => {
		const tools = getTools(null, { display_map: {} }, { excludeBuiltinTools: ['display_map'] });
		expect(tools).toHaveProperty('display_map');
	});
});
