import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UIMessage } from '../src/types/chat';
import { persistPostHogId } from '../src/utils/posthog.utils';

// Mock homedir to use a temp directory for tests
const TEST_HOME_DIR = join(tmpdir(), `posthog-test-${Date.now()}`);
vi.mock('os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('os')>();
	return {
		...actual,
		homedir: () => TEST_HOME_DIR,
	};
});

// Import after mocking
const { getAssistantMessageTrackingProperties, getPostHogDistinctId } = await import('../src/utils/posthog.utils');

describe('getPostHogDistinctId', () => {
	beforeEach(() => {
		// Ensure clean state before each test
		if (existsSync(TEST_HOME_DIR)) {
			rmSync(TEST_HOME_DIR, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		// Cleanup after each test
		if (existsSync(TEST_HOME_DIR)) {
			rmSync(TEST_HOME_DIR, { recursive: true, force: true });
		}
	});

	it('should create a new UUID when no file exists', () => {
		const id = getPostHogDistinctId();

		expect(id).toBeTruthy();
	});

	it('should return the same ID on subsequent calls (persistence)', () => {
		const firstId = getPostHogDistinctId();
		const secondId = getPostHogDistinctId();
		const thirdId = getPostHogDistinctId();

		expect(secondId).toBe(firstId);
		expect(thirdId).toBe(firstId);
	});

	it('should return existing valid UUID from file', () => {
		const existingId = crypto.randomUUID();
		persistPostHogId(existingId);

		const id = getPostHogDistinctId();

		expect(id).toBe(existingId);
	});

	it('should generate new ID when file contains invalid UUID', () => {
		persistPostHogId('not-a-valid-uuid');

		const id = getPostHogDistinctId();

		expect(id).not.toBe('not-a-valid-uuid');
	});
});

describe('getAssistantMessageTrackingProperties', () => {
	const assistantMessage = (parts: unknown[]): UIMessage =>
		({ id: 'message-1', role: 'assistant', parts }) as UIMessage;

	it('counts tool calls by type and reports no error for a clean answer', () => {
		const message = assistantMessage([
			{ type: 'step-start' },
			{ type: 'tool-execute_sql', toolCallId: '1', state: 'output-available', input: {}, output: {} },
			{ type: 'tool-execute_sql', toolCallId: '2', state: 'output-available', input: {}, output: {} },
			{ type: 'tool-display_chart', toolCallId: '3', state: 'output-available', input: {}, output: {} },
			{
				type: 'dynamic-tool',
				toolName: 'mcp_search',
				toolCallId: '4',
				state: 'output-available',
				input: {},
				output: {},
			},
			{ type: 'text', text: 'Here is your answer' },
		]);

		expect(getAssistantMessageTrackingProperties(message, undefined)).toEqual({
			tool_call_count: 4,
			tool_calls_by_type: { execute_sql: 2, display_chart: 1, mcp_search: 1 },
			tool_error_count: 0,
			tool_errors: [],
			error: null,
			has_error: false,
		});
	});

	it('reports tool errors and the stream error', () => {
		const message = assistantMessage([
			{ type: 'tool-execute_sql', toolCallId: '1', state: 'output-error', input: {}, errorText: 'syntax error' },
		]);

		expect(getAssistantMessageTrackingProperties(message, new Error('Rate limit exceeded'))).toMatchObject({
			tool_call_count: 1,
			tool_error_count: 1,
			tool_errors: [{ tool_name: 'execute_sql', error: 'syntax error' }],
			error: 'Rate limit exceeded',
			has_error: true,
		});
	});

	it('truncates long error messages', () => {
		const message = assistantMessage([]);

		const { error } = getAssistantMessageTrackingProperties(message, new Error('x'.repeat(2_000)));

		expect(error?.length).toBeLessThanOrEqual(500);
	});
});
