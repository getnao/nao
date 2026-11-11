import { describe, expect, it } from 'vitest';

import type { TestAssertion } from '../src/types/test-run';
import { evaluateAssertions, evaluateTestVerdict } from '../src/utils/test-verdict';

const clarification: TestAssertion = { type: 'tool_call', tool: 'clarification', min_count: 1 };
const executeSql: TestAssertion = { type: 'tool_call', tool: 'execute_sql', min_count: 1 };
const matchingVerification = {
	data: [{ total: 1 }],
	expectedData: [{ total: 1 }],
	expectedColumns: ['total'],
	error: null,
};

describe('evaluateTestVerdict', () => {
	it('passes an assertion-only test when the tool was called', () => {
		const verdict = evaluateTestVerdict({
			assertions: [clarification],
			toolCalls: [{ toolName: 'clarification', args: { question: 'Which period?' } }],
			hasReferenceSql: false,
			verification: null,
		});

		expect(verdict).toEqual({ passed: true, message: 'tool_call: clarification', comparison: null });
	});

	it('fails an assertion-only test when the tool was not called', () => {
		const verdict = evaluateTestVerdict({
			assertions: [clarification],
			toolCalls: [{ toolName: 'execute_sql', args: { sql_query: 'SELECT 1' } }],
			hasReferenceSql: false,
			verification: null,
		});

		expect(verdict).toEqual({ passed: false, message: 'missing tool_call: clarification', comparison: null });
	});

	it('compares the data with the given tolerances and reports the differences', () => {
		const verification = { ...matchingVerification, data: [{ total: 1.04 }], expectedData: [{ total: 1 }] };

		const strict = evaluateTestVerdict({ assertions: [], toolCalls: [], hasReferenceSql: true, verification });
		const lenient = evaluateTestVerdict({
			assertions: [],
			toolCalls: [],
			hasReferenceSql: true,
			verification,
			tolerances: { rtol: 0.1, atol: 0, decimals: 2 },
		});

		expect(strict).toEqual({
			passed: false,
			message: 'values differ',
			comparison: 'row 0, total: actual=1.04, expected=1',
		});
		expect(lenient).toEqual({ passed: true, message: 'match (approximate)', comparison: null });
	});

	it('combines data verification and assertions', () => {
		const verdict = evaluateTestVerdict({
			assertions: [executeSql],
			toolCalls: [{ toolName: 'execute_sql', args: {} }],
			hasReferenceSql: true,
			verification: matchingVerification,
		});

		expect(verdict).toEqual({ passed: true, message: 'tool_call: execute_sql; match', comparison: null });
	});

	it('fails when the data matches but an assertion does not hold', () => {
		const verdict = evaluateTestVerdict({
			assertions: [clarification],
			toolCalls: [{ toolName: 'execute_sql', args: {} }],
			hasReferenceSql: true,
			verification: matchingVerification,
		});

		expect(verdict.passed).toBe(false);
		expect(verdict.message).toBe('missing tool_call: clarification; match');
	});

	it('fails when reference SQL and assertions exist but no verification data came back', () => {
		const verdict = evaluateTestVerdict({
			assertions: [executeSql],
			toolCalls: [{ toolName: 'execute_sql', args: {} }],
			hasReferenceSql: true,
			verification: null,
		});

		expect(verdict).toEqual({
			passed: false,
			message: 'tool_call: execute_sql; no verification data',
			comparison: null,
		});
	});

	it('passes without any check to verify', () => {
		expect(
			evaluateTestVerdict({ assertions: [], toolCalls: [], hasReferenceSql: false, verification: null }),
		).toEqual({ passed: true, message: 'no verification', comparison: null });
	});
});

describe('evaluateAssertions', () => {
	it('matches args as a recursive subset', () => {
		const verdict = evaluateAssertions(
			[{ type: 'tool_call', tool: 'execute_sql', args: { options: { database: 'prod' } }, min_count: 1 }],
			[{ toolName: 'execute_sql', args: { sql_query: 'SELECT 1', options: { database: 'prod', limit: 10 } } }],
		);

		expect(verdict).toEqual({
			passed: true,
			message: 'tool_call: execute_sql (x1, args matched)',
			comparison: null,
		});
	});

	it('reports how many calls matched when the minimum count is not reached', () => {
		const verdict = evaluateAssertions(
			[{ type: 'tool_call', tool: 'execute_sql', min_count: 2 }],
			[{ toolName: 'execute_sql', args: {} }],
		);

		expect(verdict.message).toBe('missing tool_call: execute_sql (found 1, need >= 2)');
	});

	it('reports calls to the same tool whose args did not match', () => {
		const verdict = evaluateAssertions(
			[{ type: 'tool_call', tool: 'execute_sql', args: { database_id: 'prod' }, min_count: 1 }],
			[{ toolName: 'execute_sql', args: { database_id: 'staging' } }],
		);

		expect(verdict.message).toBe(
			'missing tool_call: execute_sql with args {"database_id":"prod"} (found 0 matching, need >= 1; 1 total)',
		);
	});

	it('does not treat booleans as numbers', () => {
		const verdict = evaluateAssertions(
			[{ type: 'tool_call', tool: 'display_chart', args: { stacked: true }, min_count: 1 }],
			[{ toolName: 'display_chart', args: { stacked: 1 } }],
		);

		expect(verdict.passed).toBe(false);
	});
});
