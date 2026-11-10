import { getTestAttemptMcpCallLogs } from '../queries/mcp-endpoint.queries';
import type { TestAssertion, TestComparisonTolerances } from '../types/test-run';
import type { QueryResult } from '../types/tools';
import { evaluateTestVerdict } from '../utils/test-verdict';
import { truncateMiddle } from '../utils/utils';
import { runVerificationSql, type ToolCallResult, type VerificationResult } from './test-agent.service';
import { buildVerificationPrompt } from './test-agent-verification';
import { runReferenceQuery, type TestAttemptEvaluation } from './test-evaluation.service';

const TOOL_OUTPUT_MAX_CHARS = 4_000;

interface ExternalTestInput {
	prompt: string;
	sql?: string | null;
	databaseId?: string | null;
	assertions: TestAssertion[];
	tolerances?: TestComparisonTolerances;
}

interface AttemptEvidence {
	toolCalls: ToolCallResult[];
	queryResults: Map<string, QueryResult>;
	transcript: string;
}

export type ExternalTestEvaluation =
	| { status: 'verification_required'; prompt: string }
	| ({ status: 'complete' } & TestAttemptEvaluation);

/** Evaluates a headless agent whose calls ran through nao's context-layer MCP endpoint. */
export async function evaluateExternalTestAttempt(input: {
	projectId: string;
	userId: string;
	testAttemptId: string;
	test: ExternalTestInput;
	answer: string;
	verificationSql?: string | null;
}): Promise<ExternalTestEvaluation> {
	const { projectId, userId, testAttemptId, test, answer, verificationSql } = input;
	const evidence = await loadAttemptEvidence(projectId, userId, testAttemptId);

	let verification: TestAttemptEvaluation['verification'];
	if (test.sql) {
		const { data: expectedData, columns: expectedColumns } = await runReferenceQuery(
			projectId,
			userId,
			test.sql,
			test.databaseId ?? undefined,
		);
		const verificationPrompt = buildExternalVerificationPrompt(test.prompt, answer, evidence, expectedColumns);

		if (evidence.queryResults.size === 0) {
			verification = {
				data: null,
				expectedData,
				expectedColumns,
				sql: null,
				sourceQueries: [],
				error: 'The agent did not run any SQL query.',
			};
		} else if (verificationSql === undefined) {
			return {
				status: 'verification_required',
				prompt: verificationPrompt,
			};
		} else {
			const verified = await runExternalVerification(verificationSql, evidence.queryResults, verificationPrompt);
			if (verified.status === 'repair_required') {
				return { status: 'verification_required', prompt: verified.prompt };
			}
			verification = { ...verified.result, expectedData, expectedColumns };
		}
	}

	const verdict = evaluateTestVerdict({
		assertions: test.assertions,
		toolCalls: evidence.toolCalls,
		hasReferenceSql: Boolean(test.sql),
		verification: verification ?? null,
		tolerances: test.tolerances,
	});

	return { status: 'complete', toolCalls: evidence.toolCalls, verification, verdict };
}

async function loadAttemptEvidence(projectId: string, userId: string, testAttemptId: string): Promise<AttemptEvidence> {
	const rows = await getTestAttemptMcpCallLogs(projectId, userId, testAttemptId);
	const toolCalls: ToolCallResult[] = [];
	const queryResults = new Map<string, QueryResult>();
	const transcript: string[] = [];

	for (const row of rows) {
		const args = asRecord(row.toolInput);
		const output = row.toolOutput;
		toolCalls.push({
			toolName: row.toolName,
			toolCallId: row.id,
			args,
			...(row.success ? { result: output } : { error: describeOutput(output) }),
		});
		transcript.push(
			`Tool call ${row.toolName}: ${JSON.stringify(args)}`,
			`Tool result ${row.toolName}:\n${truncateMiddle(describeOutput(output), TOOL_OUTPUT_MAX_CHARS)}`,
		);

		if (row.queryId && Array.isArray(row.queryColumns) && Array.isArray(row.queryData)) {
			queryResults.set(row.queryId, {
				columns: row.queryColumns.filter((column): column is string => typeof column === 'string'),
				data: row.queryData.filter(isRecord),
				sqlQuery: typeof args.sql_query === 'string' ? args.sql_query : undefined,
				databaseId: typeof args.database_id === 'string' ? args.database_id : undefined,
			});
		}
	}

	return { toolCalls, queryResults, transcript: transcript.join('\n\n') };
}

function buildExternalVerificationPrompt(
	prompt: string,
	answer: string,
	evidence: AttemptEvidence,
	expectedColumns: string[],
): string {
	return `You are verifying an answer produced by a data agent.

Original user prompt:
${prompt}

Agent tool transcript:
${evidence.transcript || '[No tool calls]'}

Agent final answer:
${answer || '[No visible response]'}

${buildVerificationPrompt(expectedColumns, evidence.queryResults)}

Return JSON matching this schema exactly: {"sql": string | null}`;
}

async function runExternalVerification(
	sql: string | null,
	queryResults: Map<string, QueryResult>,
	verificationPrompt: string,
): Promise<{ status: 'complete'; result: VerificationResult } | { status: 'repair_required'; prompt: string }> {
	const normalizedSql = sql?.trim() || null;
	if (!normalizedSql) {
		return {
			status: 'complete',
			result: {
				data: null,
				sql: null,
				sourceQueries: [],
				error: 'The agent could not answer from its query results.',
			},
		};
	}

	try {
		return { status: 'complete', result: await runVerificationSql(normalizedSql, queryResults) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: 'repair_required',
			prompt: `${verificationPrompt}

Your previous DuckDB query failed:

${normalizedSql}

Error: ${message}

Return corrected JSON matching {"sql": string | null}. Set sql to null if the available tables cannot answer the question.`,
		};
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeOutput(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	return JSON.stringify(value) ?? '';
}
