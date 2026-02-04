import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const { getPostHogDistinctId } = await import('../src/utils/posthog.utils');

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
