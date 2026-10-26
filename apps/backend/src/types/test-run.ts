import type { LlmSelectedModel } from '@nao/shared/types';
import { z } from 'zod/v4';

export const TEST_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export const TEST_RUN_TRIGGERS = ['manual'] as const;
export type TestRunTrigger = (typeof TEST_RUN_TRIGGERS)[number];

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
	actualData: Record<string, unknown>[] | null;
	expectedData: Record<string, unknown>[] | null;
	comparison: string | null;
	referenceSql: string | null;
	verificationSql: string | null;
}

export type TestRunModels = LlmSelectedModel[];

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
