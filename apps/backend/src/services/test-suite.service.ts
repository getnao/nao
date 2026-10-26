import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod/v4';

import {
	type InvalidTestFile,
	type NewTestFile,
	testAssertionSchema,
	type TestDefinition,
	type TestSuite,
} from '../types/test-run';

const TESTS_FOLDER = 'tests';
const OUTPUTS_FOLDER = 'outputs';
const TEST_FILE_EXTENSIONS = new Set(['.yml', '.yaml']);

const testFileSchema = z.object({
	name: z.string().trim().min(1).nullish(),
	prompt: z.string().trim().min(1),
	sql: z.string().nullish(),
	database: z.string().trim().min(1).nullish(),
	assertions: z.array(testAssertionSchema).nullish(),
	tags: z.array(z.string().trim().min(1)).nullish(),
	owner: z.string().trim().min(1).nullish(),
});

export function discoverTests(projectFolder: string): TestSuite {
	const testsFolder = path.join(projectFolder, TESTS_FOLDER);
	const tests: TestDefinition[] = [];
	const invalidFiles: InvalidTestFile[] = [];

	for (const relativePath of listTestFiles(testsFolder)) {
		const parsed = parseTestFile(testsFolder, relativePath);
		if (isInvalidTestFile(parsed)) {
			invalidFiles.push(parsed);
		} else {
			tests.push(parsed);
		}
	}

	return { tests, invalidFiles };
}

export function isInvalidTestFile(parsed: TestDefinition | InvalidTestFile): parsed is InvalidTestFile {
	return 'error' in parsed;
}

/** The path of a test relative to the tests folder, or null when the project path is not a test file. */
export function toTestPath(projectPath: string): string | null {
	const normalized = projectPath.replaceAll('\\', '/').replace(/^\/+/, '');
	if (!normalized.startsWith(`${TESTS_FOLDER}/`)) {
		return null;
	}
	const relativePath = normalized.slice(TESTS_FOLDER.length + 1);
	const isTestFile = TEST_FILE_EXTENSIONS.has(path.extname(relativePath));
	const isInOutputs = relativePath.split('/').slice(0, -1).includes(OUTPUTS_FOLDER);
	return isTestFile && !isInOutputs && !relativePath.split('/').includes('..') ? relativePath : null;
}

export function serializeTestFile(test: NewTestFile): string {
	const document: Record<string, unknown> = { name: test.name, prompt: test.prompt };
	if (test.sql) {
		document.sql = test.sql;
	}
	if (test.databaseId) {
		document.database = test.databaseId;
	}
	if (test.tags?.length) {
		document.tags = test.tags;
	}
	if (test.owner) {
		document.owner = test.owner;
	}
	return yaml.dump(document, { lineWidth: -1 });
}

/** Candidate explorer paths for a new test file, the first one free being used. */
export function newTestFilePaths(name: string, maxCandidates = 20): string[] {
	const slug =
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'test';
	return Array.from({ length: maxCandidates }, (_, index) =>
		index === 0 ? `/${TESTS_FOLDER}/${slug}.yml` : `/${TESTS_FOLDER}/${slug}-${index + 1}.yml`,
	);
}

export function filterTests(
	tests: TestDefinition[],
	selection: { paths?: string[]; tags?: string[] },
): TestDefinition[] {
	const paths = selection.paths?.length ? new Set(selection.paths) : null;
	const tags = selection.tags?.length ? new Set(selection.tags) : null;
	return tests.filter((test) => {
		if (paths && !paths.has(test.path)) {
			return false;
		}
		return !tags || test.tags.some((tag) => tags.has(tag));
	});
}

function listTestFiles(testsFolder: string): string[] {
	if (!fs.existsSync(testsFolder)) {
		return [];
	}
	return collectTestFiles(testsFolder, '').sort();
}

function collectTestFiles(folder: string, relativeFolder: string): string[] {
	return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const relativePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			return entry.name === OUTPUTS_FOLDER ? [] : collectTestFiles(path.join(folder, entry.name), relativePath);
		}
		return entry.isFile() && TEST_FILE_EXTENSIONS.has(path.extname(entry.name)) ? [relativePath] : [];
	});
}

function parseTestFile(testsFolder: string, relativePath: string): TestDefinition | InvalidTestFile {
	let content: string;
	try {
		content = fs.readFileSync(path.join(testsFolder, relativePath), 'utf-8');
	} catch (error) {
		return { path: relativePath, error: `Unreadable file: ${describeError(error)}` };
	}
	return parseTestContent(relativePath, content);
}

/** Parses a test from its YAML content, given its path relative to the tests folder. */
export function parseTestContent(relativePath: string, content: string): TestDefinition | InvalidTestFile {
	let data: unknown;
	try {
		data = yaml.load(content, { schema: yaml.CORE_SCHEMA });
	} catch (error) {
		return { path: relativePath, error: `Invalid YAML: ${describeError(error)}` };
	}

	const parsed = testFileSchema.safeParse(data);
	if (!parsed.success) {
		return { path: relativePath, error: z.prettifyError(parsed.error) };
	}

	const test = parsed.data;
	return {
		path: relativePath,
		name: test.name ?? path.basename(relativePath, path.extname(relativePath)),
		prompt: test.prompt,
		sql: test.sql?.trim() || null,
		databaseId: test.database ?? null,
		assertions: test.assertions ?? [],
		tags: [...new Set(test.tags ?? [])],
		owner: test.owner ?? null,
		hash: createHash('sha256').update(content).digest('hex'),
	};
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
