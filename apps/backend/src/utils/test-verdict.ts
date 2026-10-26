import type {
	TestAssertion,
	TestComparisonTolerances,
	TestToolCall,
	TestVerdict,
	ToolCallAssertion,
} from '../types/test-run';
import { compareTestData } from './test-data-comparison';

export interface TestVerification {
	data: Record<string, unknown>[] | null;
	expectedData: Record<string, unknown>[];
	expectedColumns: string[];
	error: string | null;
}

/**
 * Decides whether a test run passed: assertions on the agent's tool calls must hold, and when
 * the test has reference SQL, the agent's data must match the expected data.
 */
export function evaluateTestVerdict(input: {
	assertions: TestAssertion[];
	toolCalls: TestToolCall[];
	hasReferenceSql: boolean;
	verification: TestVerification | null;
	tolerances?: TestComparisonTolerances;
}): TestVerdict {
	const assertionsVerdict = evaluateAssertions(input.assertions, input.toolCalls);

	if (input.verification) {
		const dataVerdict = compareTestData(
			{
				actual: input.verification.data,
				expected: input.verification.expectedData,
				expectedColumns: input.verification.expectedColumns,
				error: input.verification.error,
			},
			input.tolerances,
		);
		return {
			passed: assertionsVerdict.passed && dataVerdict.passed,
			message: combineCheckMessages(assertionsVerdict.message, dataVerdict.message),
			comparison: dataVerdict.comparison,
		};
	}

	if (input.assertions.length > 0 && !input.hasReferenceSql) {
		return assertionsVerdict;
	}

	if (input.assertions.length > 0) {
		return {
			passed: false,
			message: combineCheckMessages(assertionsVerdict.message, 'no verification data'),
			comparison: null,
		};
	}

	return { passed: true, message: 'no verification', comparison: null };
}

export function evaluateAssertions(assertions: TestAssertion[], toolCalls: TestToolCall[]): TestVerdict {
	const results = assertions.map((assertion) => evaluateToolCallAssertion(assertion, toolCalls));
	return {
		passed: results.every((result) => result.passed),
		message: results.map((result) => result.message).join('; '),
		comparison: null,
	};
}

function evaluateToolCallAssertion(
	assertion: ToolCallAssertion,
	toolCalls: TestToolCall[],
): Pick<TestVerdict, 'passed' | 'message'> {
	const { tool, args, min_count: minCount } = assertion;
	const matchCount = toolCalls.filter(
		(call) => call.toolName === tool && (args === undefined || isArgsSubset(args, call.args ?? {})),
	).length;

	if (matchCount >= minCount) {
		return { passed: true, message: describeMatchedAssertion(assertion, matchCount) };
	}

	if (args !== undefined) {
		const sameToolCount = toolCalls.filter((call) => call.toolName === tool).length;
		const expectedArgs = JSON.stringify(args);
		return {
			passed: false,
			message: sameToolCount
				? `missing tool_call: ${tool} with args ${expectedArgs} (found ${matchCount} matching, need >= ${minCount}; ${sameToolCount} total)`
				: `missing tool_call: ${tool} with args ${expectedArgs}`,
		};
	}

	return {
		passed: false,
		message:
			minCount > 1
				? `missing tool_call: ${tool} (found ${matchCount}, need >= ${minCount})`
				: `missing tool_call: ${tool}`,
	};
}

function describeMatchedAssertion({ tool, args, min_count: minCount }: ToolCallAssertion, matchCount: number): string {
	if (minCount === 1 && args === undefined) {
		return `tool_call: ${tool}`;
	}
	const details = [`x${matchCount}`];
	if (minCount > 1) {
		details.push(`min ${minCount}`);
	}
	if (args !== undefined) {
		details.push('args matched');
	}
	return `tool_call: ${tool} (${details.join(', ')})`;
}

/** Expected values must appear in the actual args: objects match recursively, everything else by equality. */
function isArgsSubset(expected: unknown, actual: unknown): boolean {
	if (isPlainObject(expected)) {
		return (
			isPlainObject(actual) &&
			Object.entries(expected).every(([key, value]) => key in actual && isArgsSubset(value, actual[key]))
		);
	}
	return isDeepEqual(expected, actual);
}

function isDeepEqual(left: unknown, right: unknown): boolean {
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((item, index) => isDeepEqual(item, right[index]))
		);
	}
	if (isPlainObject(left) || isPlainObject(right)) {
		return (
			isPlainObject(left) &&
			isPlainObject(right) &&
			Object.keys(left).length === Object.keys(right).length &&
			Object.entries(left).every(([key, value]) => key in right && isDeepEqual(value, right[key]))
		);
	}
	return left === right;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function combineCheckMessages(...parts: string[]): string {
	return parts.filter(Boolean).join('; ');
}
