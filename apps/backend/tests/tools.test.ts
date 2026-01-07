import 'dotenv/config';

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toolAgentHandler } from '../src/tools/toolAgentHandler';

describe('toolAgentHandler', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-test-'));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	describe('readFile', () => {
		it('should read file content and return line count', async () => {
			const testFile = path.join(tempDir, 'test.txt');
			const content = 'Line 1\nLine 2\nLine 3';
			await fs.writeFile(testFile, content);

			const result = await toolAgentHandler.readFile({ file_path: testFile });

			expect(result.content).toBe(content);
			expect(result.numberOfTotalLines).toBe(3);
		});

		it('should throw error for non-existent file', async () => {
			const nonExistentFile = path.join(tempDir, 'nonexistent.txt');

			await expect(toolAgentHandler.readFile({ file_path: nonExistentFile })).rejects.toThrow(
				`Error reading file at ${nonExistentFile}`,
			);
		});

		it('should handle empty file', async () => {
			const testFile = path.join(tempDir, 'empty.txt');
			await fs.writeFile(testFile, '');

			const result = await toolAgentHandler.readFile({ file_path: testFile });

			expect(result.content).toBe('');
			expect(result.numberOfTotalLines).toBe(1);
		});
	});

	describe('searchFiles', () => {
		beforeEach(async () => {
			await fs.mkdir(path.join(tempDir, 'subdir'));
			await fs.writeFile(path.join(tempDir, 'test1.ts'), 'content1');
			await fs.writeFile(path.join(tempDir, 'test2.ts'), 'content2');
			await fs.writeFile(path.join(tempDir, 'test.js'), 'content3');
			await fs.writeFile(path.join(tempDir, 'subdir', 'test3.ts'), 'content4');
		});

		it('should find all files matching pattern', async () => {
			const pattern = path.join(tempDir, '**/*.ts');

			const result = await toolAgentHandler.searchFiles({ file_pattern: pattern });

			expect(result).toHaveLength(3);
			expect(result.map((r) => path.basename(r.relativeFilePath)).sort()).toEqual([
				'test1.ts',
				'test2.ts',
				'test3.ts',
			]);
		});

		it('should return file metadata', async () => {
			const pattern = path.join(tempDir, 'test1.ts');

			const result = await toolAgentHandler.searchFiles({ file_pattern: pattern });

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveProperty('absoluteFilePath');
			expect(result[0]).toHaveProperty('relativeFilePath');
			expect(result[0]).toHaveProperty('relativeDirPath');
			expect(result[0]).toHaveProperty('size');
			expect(result[0].absoluteFilePath).toContain('test1.ts');
		});

		it('should return empty array for no matches', async () => {
			const pattern = path.join(tempDir, '*.nonexistent');

			const result = await toolAgentHandler.searchFiles({ file_pattern: pattern });

			expect(result).toHaveLength(0);
		});
	});

	describe('listDirectory', () => {
		beforeEach(async () => {
			await fs.mkdir(path.join(tempDir, 'subdir'));
			await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
			await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2');
		});

		it('should list all entries in directory', async () => {
			const result = await toolAgentHandler.listDirectory({ path: tempDir });

			expect(result).toHaveLength(3);
			const names = result.map((r) => r.name).sort();
			const types = result.map((r) => r.type);
			expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir']);
			expect(types).toEqual(['file', 'file', 'directory']);
		});

		it('should distinguish between files and directories', async () => {
			const result = await toolAgentHandler.listDirectory({ path: tempDir });

			const file = result.find((r) => r.name === 'file1.txt');
			const dir = result.find((r) => r.name === 'subdir');

			expect(file?.type).toBe('file');
			expect(file?.size).toBeDefined();
			expect(dir?.type).toBe('directory');
			expect(dir?.size).toBeUndefined();
		});

		it('should throw error for non-existent directory', async () => {
			const nonExistentDir = path.join(tempDir, 'nonexistent');

			await expect(toolAgentHandler.listDirectory({ path: nonExistentDir })).rejects.toThrow(
				`Error listing directory at ${nonExistentDir}`,
			);
		});

		it('should return empty array for empty directory', async () => {
			const emptyDir = path.join(tempDir, 'empty');
			await fs.mkdir(emptyDir);

			const result = await toolAgentHandler.listDirectory({ path: emptyDir });

			expect(result).toHaveLength(0);
		});
	});

	describe('grepCodebase', () => {
		beforeEach(async () => {
			await fs.writeFile(path.join(tempDir, 'file1.ts'), 'const hello = "world";\nconst foo = "bar";');
			await fs.writeFile(path.join(tempDir, 'file2.ts'), 'const HELLO = "WORLD";\nconst test = "value";');
			await fs.writeFile(path.join(tempDir, 'file3.js'), 'const hello = "js";');
		});

		it('should find pattern in files', async () => {
			const result = await toolAgentHandler.grepCodebase({
				pattern: 'hello',
				include: [path.join(tempDir, '*.ts')],
				exclude: [],
				case_sensitive: false,
			});

			expect(result.length).toBeGreaterThanOrEqual(2);
			expect(result.some((r) => r.relativePath.includes('file1.ts'))).toBe(true);
			expect(result.some((r) => r.relativePath.includes('file2.ts'))).toBe(true);
		});

		it('should respect case sensitivity', async () => {
			const caseSensitive = await toolAgentHandler.grepCodebase({
				pattern: 'hello',
				include: [path.join(tempDir, '*.ts')],
				exclude: [],
				case_sensitive: true,
			});

			const caseInsensitive = await toolAgentHandler.grepCodebase({
				pattern: 'hello',
				include: [path.join(tempDir, '*.ts')],
				exclude: [],
				case_sensitive: false,
			});

			expect(caseSensitive.length).toBeLessThan(caseInsensitive.length);
		});

		it('should exclude files matching exclude pattern', async () => {
			const result = await toolAgentHandler.grepCodebase({
				pattern: 'hello',
				include: [path.join(tempDir, '*')],
				exclude: [path.join(tempDir, '*.js')],
				case_sensitive: false,
			});

			expect(result.every((r) => !r.relativePath.includes('.js'))).toBe(true);
		});

		it('should return match details', async () => {
			const result = await toolAgentHandler.grepCodebase({
				pattern: 'const',
				include: [path.join(tempDir, 'file1.ts')],
				exclude: [],
				case_sensitive: true,
			});

			expect(result.length).toBeGreaterThan(0);
			expect(result[0]).toHaveProperty('line');
			expect(result[0]).toHaveProperty('text');
			expect(result[0]).toHaveProperty('matchCount');
			expect(result[0]).toHaveProperty('absolutePath');
			expect(result[0]).toHaveProperty('relativePath');
			expect(result[0].line).toBeGreaterThan(0);
		});

		it('should count multiple matches on same line', async () => {
			await fs.writeFile(path.join(tempDir, 'multi.ts'), 'const x = const y = const z;');

			const result = await toolAgentHandler.grepCodebase({
				pattern: 'const',
				include: [path.join(tempDir, 'multi.ts')],
				exclude: [],
				case_sensitive: true,
			});

			expect(result).toHaveLength(1);
			expect(result[0].matchCount).toBe(3);
		});

		it('should return empty array for no matches', async () => {
			const result = await toolAgentHandler.grepCodebase({
				pattern: 'nonexistentpattern12345',
				include: [path.join(tempDir, '*.ts')],
				exclude: [],
				case_sensitive: false,
			});

			expect(result).toHaveLength(0);
		});
	});
});
