import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getTestAttemptMcpCallLogs: vi.fn(),
	runReferenceQuery: vi.fn(),
	runVerificationSql: vi.fn(),
}));

vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	getTestAttemptMcpCallLogs: mocks.getTestAttemptMcpCallLogs,
}));
vi.mock('../src/services/test-evaluation.service', () => ({
	runReferenceQuery: mocks.runReferenceQuery,
}));
vi.mock('../src/services/test-agent.service', () => ({
	runVerificationSql: mocks.runVerificationSql,
}));

import { evaluateExternalTestAttempt } from '../src/services/external-test-evaluation.service';

const CAPTURED_QUERY = {
	id: 'call-1',
	toolName: 'execute_sql',
	durationMs: 5,
	success: true,
	toolInput: { sql_query: 'select 10 as total', database_id: 'warehouse' },
	toolOutput: { columns: ['total'], data: [{ total: 10 }], query_id: 'query_1' },
	calledAt: new Date(),
	queryId: 'query_1',
	queryColumns: ['total'],
	queryData: [{ total: 10 }],
};

describe('external test evaluation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getTestAttemptMcpCallLogs.mockResolvedValue([CAPTURED_QUERY]);
		mocks.runReferenceQuery.mockResolvedValue({ columns: ['total'], data: [{ total: 10 }] });
		mocks.runVerificationSql.mockResolvedValue({
			data: [{ total: 10 }],
			sql: 'select total from query_1',
			sourceQueries: [{ id: 'query_1', sql: 'select 10 as total' }],
			error: null,
		});
	});

	it('asks the harness to express its answer over the captured query tables', async () => {
		const evaluation = await evaluateExternalTestAttempt({
			projectId: 'project-1',
			userId: 'user-1',
			testAttemptId: 'attempt-1',
			test: { prompt: 'Revenue?', sql: 'select 10 as total', assertions: [] },
			answer: 'Revenue is 10.',
		});

		expect(evaluation).toEqual(
			expect.objectContaining({
				status: 'verification_required',
				prompt: expect.stringMatching(/query_1 \(1 rows\): total/),
			}),
		);
	});

	it('runs the verification SQL and compares it with the live reference query', async () => {
		const evaluation = await evaluateExternalTestAttempt({
			projectId: 'project-1',
			userId: 'user-1',
			testAttemptId: 'attempt-1',
			test: {
				prompt: 'Revenue?',
				sql: 'select 10 as total',
				assertions: [{ type: 'tool_call', tool: 'execute_sql', min_count: 1 }],
			},
			answer: 'Revenue is 10.',
			verificationSql: 'select total from query_1',
		});

		expect(mocks.runVerificationSql).toHaveBeenCalledWith('select total from query_1', expect.any(Map));
		expect(evaluation).toEqual(
			expect.objectContaining({
				status: 'complete',
				verdict: { passed: true, message: 'tool_call: execute_sql; match', comparison: null },
			}),
		);
	});

	it('returns a repair prompt when the verification SQL fails', async () => {
		mocks.runVerificationSql.mockRejectedValue(new Error('column missing does not exist'));

		const evaluation = await evaluateExternalTestAttempt({
			projectId: 'project-1',
			userId: 'user-1',
			testAttemptId: 'attempt-1',
			test: { prompt: 'Revenue?', sql: 'select 10 as total', assertions: [] },
			answer: 'Revenue is 10.',
			verificationSql: 'select missing from query_1',
		});

		expect(evaluation).toEqual({
			status: 'verification_required',
			prompt: expect.stringContaining('column missing does not exist'),
		});
	});
});
