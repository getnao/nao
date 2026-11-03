import type { LlmSelectedModel } from '@nao/shared/types';
import { z } from 'zod/v4';

export const TEST_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export const TEST_RUN_TRIGGERS = ['manual', 'draft', 'comparison'] as const;
export type TestRunTrigger = (typeof TEST_RUN_TRIGGERS)[number];

/** The context an attempt ran against: the production one, or the production one with the user's changes. */
export const TEST_CONTEXT_VARIANTS = ['production', 'draft'] as const;
export type TestContextVariant = (typeof TEST_CONTEXT_VARIANTS)[number];

export interface TestContextChange {
	/** Path relative to the context folder. */
	path: string;
	kind: 'added' | 'modified' | 'deleted';
}

export const MAX_TEST_RUN_ATTEMPTS = 10;
export const MAX_TEST_RUN_MODELS = 10;

export const testComparisonTolerancesSchema = z.object({
	rtol: z.number().min(0).default(1e-5),
	atol: z.number().min(0).default(1e-8),
	decimals: z.number().int().min(0).max(100).default(2),
});
export type TestComparisonTolerances = z.infer<typeof testComparisonTolerancesSchema>;

export const DEFAULT_TEST_COMPARISON_TOLERANCES: TestComparisonTolerances = testComparisonTolerancesSchema.parse({});

export const toolCallAssertionSchema = z
	.object({
		type: z.literal('tool_call'),
		tool: z.string().trim().min(1),
		args: z
			.record(z.string(), z.unknown())
			.refine((args) => Object.keys(args).length > 0, {
				message: "'args' must not be empty; omit 'args' to match any call to the tool",
			})
			.optional(),
		min_count: z.number().int().min(1).default(1),
	})
	.strict();
export type ToolCallAssertion = z.infer<typeof toolCallAssertionSchema>;

export const testAssertionSchema = toolCallAssertionSchema;
export type TestAssertion = ToolCallAssertion;

export interface TestToolCall {
	toolName: string;
	args?: Record<string, unknown> | null;
}

export interface TestVerdict {
	passed: boolean;
	message: string;
	/** Readable diff between the agent data and the expected data, when they differ. */
	comparison: string | null;
}

export interface TestRunResultDetails {
	responseText: string | null;
	/** Rows in the order the verdict compares them, cut to the first stored rows. */
	actualData: Record<string, unknown>[] | null;
	expectedData: Record<string, unknown>[] | null;
	/** Row counts before the rows were cut, missing on results recorded before they were stored. */
	actualRowCount?: number | null;
	expectedRowCount?: number | null;
	comparison: string | null;
	referenceSql: string | null;
	verificationSql: string | null;
}

export type TestDataCell = number | string | boolean | null;
export type TestDataCellStatus = 'match' | 'close' | 'differ';

/** The expected and actual rows side by side, normalized and sorted the way the verdict compares them. */
export interface TestDataDiff {
	/** Expected columns, in the order of the reference query. */
	columns: string[];
	/** Expected columns the answer does not have. */
	missingColumns: string[];
	/** Answer columns the test does not expect, which do not fail it. */
	extraColumns: string[];
	expectedRowCount: number;
	actualRowCount: number;
	rows: TestDataDiffRow[];
	/** Rows past the stored ones are not compared. */
	isTruncated: boolean;
}

export interface TestDataDiffRow {
	expected: TestDataCell[] | null;
	actual: TestDataCell[] | null;
	/** One status per column, null when only one side has this row. */
	statuses: TestDataCellStatus[] | null;
}

export type TestRunModels = LlmSelectedModel[];

/** How one model did over the attempts of a run against one context variant, with the metrics `nao test` reports. */
export interface TestModelSummary extends LlmSelectedModel {
	contextVariant: TestContextVariant;
	attempts: number;
	passedAttempts: number;
	testCount: number;
	/** Tests where every attempt passed. */
	reliableTestCount: number;
	/** Null when no attempt recorded a cost, as for a model without pricing. */
	totalCost: number | null;
	costPerQuestion: number | null;
	/** Total cost over the passed attempts, which ranks cheap but wrong models low. */
	costPerCorrectAnswer: number | null;
	averageToolCalls: number | null;
	medianDurationMs: number | null;
	averageTokens: number | null;
}

/** A model's summary in an earlier run, over the same tests, to show how the model changed since. */
export interface PreviousTestModelSummary {
	runId: string;
	runCreatedAt: Date;
	summary: TestModelSummary;
}

/** What a model costs and takes per question in the recent runs of the project, to estimate a new run. */
export interface TestModelStats extends LlmSelectedModel {
	attempts: number;
	averageCost: number | null;
	averageDurationMs: number | null;
}

/** The `test` block of nao_config.yaml. */
export interface ConfiguredTestSettings {
	/** Null when the project does not pin test models. */
	models: TestRunModels | null;
	attempts: number;
	tolerances: TestComparisonTolerances;
	/** Invalid values of the `test` block, which `nao test` rejects too. */
	errors: string[];
}

export interface TestDefinition {
	/** Path relative to the tests folder, which identifies the test across runs and branches. */
	path: string;
	name: string;
	prompt: string;
	sql: string | null;
	databaseId: string | null;
	assertions: TestAssertion[];
	tags: string[];
	owner: string | null;
	/** Hash of the file content, to tell whether a test changed between two runs. */
	hash: string;
}

export interface NewTestFile {
	name: string;
	prompt: string;
	sql?: string | null;
	databaseId?: string | null;
	tags?: string[];
	owner?: string | null;
}

export interface InvalidTestFile {
	path: string;
	error: string;
}

export interface TestSuite {
	tests: TestDefinition[];
	invalidFiles: InvalidTestFile[];
}
