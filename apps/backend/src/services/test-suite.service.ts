import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod/v4';

import { type InvalidTestFile, testAssertionSchema, type TestDefinition, type TestSuite } from '../types/test-run';

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
		if ('error' in parsed) {
			invalidFiles.push(parsed);
		} else {
			tests.push(parsed);
		}
	}

	return { tests, invalidFiles };
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
	const content = fs.readFileSync(path.join(testsFolder, relativePath), 'utf-8');

	let data: unknown;
	try {
		data = yaml.load(content);
	} catch (error) {
		return { path: relativePath, error: `Invalid YAML: ${error instanceof Error ? error.message : String(error)}` };
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
