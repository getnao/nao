import { afterEach, describe, expect, it, vi } from 'vitest';

const POSIX_PROJECT = '/home/user/project';
const WIN32_PROJECT = 'C:\\Users\\user\\project';
const WIN32_FORWARD_SLASH_PROJECT = 'C:/Users/user/project';

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('toRealPath', () => {
	describe('posix', () => {
		it.each([
			['resolves virtual path with leading slash', '/databases', POSIX_PROJECT, '/home/user/project/databases'],
			['resolves virtual path without leading slash', 'agent', POSIX_PROJECT, '/home/user/project/agent'],
			['resolves root virtual path to project folder', '/', POSIX_PROJECT, POSIX_PROJECT],
			[
				'resolves nested paths',
				'/databases/schemas/public.sql',
				POSIX_PROJECT,
				'/home/user/project/databases/schemas/public.sql',
			],
			[
				'normalizes trailing slash on project folder',
				'/databases',
				'/home/user/project/',
				'/home/user/project/databases',
			],
		])('%s', async (_name, virtualPath, projectFolder, expected) => {
			const { toRealPath } = await loadTools('posix');
			expect(toRealPath(virtualPath, projectFolder)).toBe(expected);
		});

		it.each([
			['rejects path traversal with ..', '/../etc/passwd', 'outside the project folder'],
			['rejects path traversal with relative ..', '../etc/passwd', 'outside the project folder'],
			['rejects excluded .meta directory', '/.meta/something', 'excluded directory'],
		])('%s', async (_name, virtualPath, error) => {
			const { toRealPath } = await loadTools('posix');
			expect(() => toRealPath(virtualPath, POSIX_PROJECT)).toThrow(error);
		});

		it('rejects protected paths regardless of case', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(() => toRealPath('/.GIT/config', POSIX_PROJECT)).toThrow('protected .git metadata');
			expect(() => toRealPath('/.Env', POSIX_PROJECT)).toThrow('protected environment file');
			expect(() => toRealPath('/.MeTa/something', POSIX_PROJECT)).toThrow('excluded directory');
		});
	});

	describe('win32', () => {
		it.each([
			[
				'resolves with backslash project folder',
				'/databases',
				WIN32_PROJECT,
				'C:\\Users\\user\\project\\databases',
			],
			[
				'resolves with forward-slash project folder',
				'/databases',
				WIN32_FORWARD_SLASH_PROJECT,
				'C:\\Users\\user\\project\\databases',
			],
			[
				'resolves without leading slash and forward-slash project folder',
				'agent',
				WIN32_FORWARD_SLASH_PROJECT,
				'C:\\Users\\user\\project\\agent',
			],
			['resolves root virtual path to project folder', '/', WIN32_PROJECT, WIN32_PROJECT],
			[
				'resolves nested paths with forward-slash project folder',
				'/databases/schemas/public.sql',
				WIN32_FORWARD_SLASH_PROJECT,
				'C:\\Users\\user\\project\\databases\\schemas\\public.sql',
			],
			[
				'handles mixed separators in project folder',
				'/agent',
				'C:/Users\\user/project',
				'C:\\Users\\user\\project\\agent',
			],
		])('%s', async (_name, virtualPath, projectFolder, expected) => {
			const { toRealPath } = await loadTools('win32');
			expect(toRealPath(virtualPath, projectFolder)).toBe(expected);
		});

		it.each([
			['rejects path traversal', '/../something', 'outside the project folder'],
			['rejects excluded .meta directory', '/.meta/data', 'excluded directory'],
		])('%s', async (_name, virtualPath, error) => {
			const { toRealPath } = await loadTools('win32');
			expect(() => toRealPath(virtualPath, WIN32_PROJECT)).toThrow(error);
		});

		it('rejects protected paths regardless of case', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(() => toRealPath('/.GIT/config', WIN32_PROJECT)).toThrow('protected .git metadata');
			expect(() => toRealPath('/.Env', WIN32_PROJECT)).toThrow('protected environment file');
			expect(() => toRealPath('/.MeTa/data', WIN32_PROJECT)).toThrow('excluded directory');
		});
	});
});

describe('toVirtualPath', () => {
	describe('posix', () => {
		it.each([
			['converts real path to virtual path', '/home/user/project/databases', '/databases'],
			['converts project folder itself to /', POSIX_PROJECT, '/'],
			[
				'converts nested real path to virtual path',
				'/home/user/project/databases/schemas/public.sql',
				'/databases/schemas/public.sql',
			],
		])('%s', async (_name, realPath, expected) => {
			const { toVirtualPath } = await loadTools('posix');
			expect(toVirtualPath(realPath, POSIX_PROJECT)).toBe(expected);
		});

		it('rejects paths outside project folder', async () => {
			const { toVirtualPath } = await loadTools('posix');
			expect(() => toVirtualPath('/etc/passwd', POSIX_PROJECT)).toThrow('outside the project folder');
		});
	});

	describe('win32', () => {
		it.each([
			[
				'converts real path using forward slashes in output',
				'C:\\Users\\user\\project\\databases',
				WIN32_PROJECT,
				'/databases',
			],
			[
				'converts nested path using forward slashes in output',
				'C:\\Users\\user\\project\\databases\\schemas\\public.sql',
				WIN32_PROJECT,
				'/databases/schemas/public.sql',
			],
			['converts project folder itself to /', WIN32_PROJECT, WIN32_PROJECT, '/'],
			[
				'works with forward-slash project folder',
				'C:\\Users\\user\\project\\agent',
				WIN32_FORWARD_SLASH_PROJECT,
				'/agent',
			],
			[
				'returns forward slashes even for deeply nested Windows paths',
				'C:\\Users\\user\\project\\a\\b\\c\\d.txt',
				WIN32_PROJECT,
				'/a/b/c/d.txt',
			],
		])('%s', async (_name, realPath, projectFolder, expected) => {
			const { toVirtualPath } = await loadTools('win32');
			expect(toVirtualPath(realPath, projectFolder)).toBe(expected);
		});

		it('rejects paths outside project folder', async () => {
			const { toVirtualPath } = await loadTools('win32');
			expect(() => toVirtualPath('C:\\Windows\\system32', WIN32_PROJECT)).toThrow('outside the project folder');
		});
	});
});

describe('isWithinProjectFolder', () => {
	describe('posix', () => {
		it.each([
			['returns true for paths inside project folder', '/home/user/project/databases', true],
			['returns true for the project folder itself', POSIX_PROJECT, true],
			['returns false for paths outside project folder', '/etc/passwd', false],
			['returns false for sibling with matching prefix', '/home/user/project-other/file', false],
			['returns false for excluded .meta directory', '/home/user/project/.meta/data', false],
		])('%s', async (_name, candidatePath, expected) => {
			const { isWithinProjectFolder } = await loadTools('posix');
			expect(isWithinProjectFolder(candidatePath, POSIX_PROJECT)).toBe(expected);
		});
	});

	describe('win32', () => {
		it.each([
			[
				'returns true for paths inside project folder',
				'C:\\Users\\user\\project\\databases',
				WIN32_PROJECT,
				true,
			],
			[
				'returns true with forward-slash project folder',
				'C:\\Users\\user\\project\\databases',
				WIN32_FORWARD_SLASH_PROJECT,
				true,
			],
			['returns true for the project folder itself', WIN32_PROJECT, WIN32_PROJECT, true],
			[
				'returns true for project folder itself with mixed slashes',
				WIN32_PROJECT,
				WIN32_FORWARD_SLASH_PROJECT,
				true,
			],
			['returns false for paths outside project folder', 'C:\\Windows\\system32', WIN32_PROJECT, false],
			[
				'returns false for sibling with matching prefix',
				'C:\\Users\\user\\project-other\\file',
				WIN32_PROJECT,
				false,
			],
			['returns false for different drive', 'D:\\project\\file', WIN32_PROJECT, false],
			[
				'returns false for excluded .meta directory',
				'C:\\Users\\user\\project\\.meta\\data',
				WIN32_PROJECT,
				false,
			],
		])('%s', async (_name, candidatePath, projectFolder, expected) => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder(candidatePath, projectFolder)).toBe(expected);
		});
	});
});

describe('built-in path exclusions', () => {
	it('matches excluded entries regardless of case', async () => {
		const { isExcludedEntry, isInExcludedDir } = await loadTools('posix');

		expect(isExcludedEntry('.GIT')).toBe(true);
		expect(isExcludedEntry('.Env')).toBe(true);
		expect(isExcludedEntry('.MeTa')).toBe(true);
		expect(isInExcludedDir('/home/user/project/.MeTa/file.txt')).toBe(true);
	});
});

describe('storage mount', () => {
	const PROJECT = '/srv/project';

	it.each(['/home', 'home', '/home/', '/home/reports/q1.csv', 'home/reports/q1.csv', '~', '~/reports/q1.csv'])(
		'recognises %j as permanent storage',
		async (virtualPath) => {
			const { isStoragePath } = await loadTools('posix');
			expect(isStoragePath(virtualPath)).toBe(true);
		},
	);

	it.each(['/', '/databases', '/homes', '/agent/home', 'my-home', '~notes.md', undefined])(
		'does not recognise %j as permanent storage',
		async (virtualPath) => {
			const { isStoragePath } = await loadTools('posix');
			expect(isStoragePath(virtualPath)).toBe(false);
		},
	);

	it('maps a mount path to the path inside the user space', async () => {
		const { toStorageRelativePath } = await loadTools('posix');
		expect(toStorageRelativePath('/home/reports/q1.csv')).toBe('reports/q1.csv');
		expect(toStorageRelativePath('/home')).toBe('');
		expect(toStorageRelativePath('/home/')).toBe('');
	});

	it('accepts the ~ shorthand but never emits it', async () => {
		const { toStorageRelativePath, toStorageVirtualPath } = await loadTools('posix');

		expect(toStorageRelativePath('~/reports/q1.csv')).toBe('reports/q1.csv');
		expect(toStorageRelativePath('~')).toBe('');
		expect(toStorageVirtualPath('reports/q1.csv')).toBe('/home/reports/q1.csv');
	});

	it('maps a path inside the user space back to the tree', async () => {
		const { toStorageVirtualPath } = await loadTools('posix');
		expect(toStorageVirtualPath('reports/q1.csv')).toBe('/home/reports/q1.csv');
		expect(toStorageVirtualPath('')).toBe('/home');
	});

	it('never resolves a mount path against the project folder', async () => {
		const { toRealPath } = await loadTools('posix');
		expect(() => toRealPath('/home/reports/q1.csv', PROJECT)).toThrow('in permanent storage');
		expect(() => toRealPath('/tmp/../home/reports/q1.csv', PROJECT)).toThrow('in permanent storage');
	});

	it('hides a project folder that shadows the mount name', async () => {
		const { isWithinProjectFolder, shouldExcludeEntry } = await loadTools('posix');

		expect(isWithinProjectFolder(`${PROJECT}/home/notes.md`, PROJECT)).toBe(false);
		expect(shouldExcludeEntry('home', '', PROJECT)).toBe(true);
	});

	it('keeps a nested folder called home reachable', async () => {
		const { isWithinProjectFolder, shouldExcludeEntry } = await loadTools('posix');

		expect(isWithinProjectFolder(`${PROJECT}/docs/home/notes.md`, PROJECT)).toBe(true);
		expect(shouldExcludeEntry('home', 'docs', PROJECT)).toBe(false);
	});
});

describe('loadNaoignorePatterns cache invalidation', () => {
	it('returns cached patterns when the file signature is unchanged', async () => {
		const { loadNaoignorePatterns } = await loadToolsWithNaoignoreFiles([
			{ content: 'templates/\n', mtimeMs: 1000 },
			{ content: 'templates/\n', mtimeMs: 1000 },
			{ content: 'templates/\n', mtimeMs: 1000 },
		]);

		expect(loadNaoignorePatterns('/project')).toEqual(['templates/']);
		expect(loadNaoignorePatterns('/project')).toEqual(['templates/']);
	});

	it('reloads patterns when the file mtime changes', async () => {
		const { loadNaoignorePatterns } = await loadToolsWithNaoignoreFiles([
			{ content: 'templates/\n', mtimeMs: 1000 },
			{ content: 'templates/\n', mtimeMs: 1000 },
			{ content: '*.j2\ntests/\n', mtimeMs: 2000 },
			{ content: '*.j2\ntests/\n', mtimeMs: 2000 },
		]);

		expect(loadNaoignorePatterns('/project')).toEqual(['templates/']);
		expect(loadNaoignorePatterns('/project')).toEqual(['*.j2', 'tests/']);
	});

	it('reloads patterns when the file size changes', async () => {
		const { loadNaoignorePatterns } = await loadToolsWithNaoignoreFiles([
			{ content: 'templates/\n', mtimeMs: 1000, size: 11 },
			{ content: 'templates/\n', mtimeMs: 1000, size: 11 },
			{ content: 'tests/\n', mtimeMs: 1000, size: 7 },
			{ content: 'tests/\n', mtimeMs: 1000, size: 7 },
		]);

		expect(loadNaoignorePatterns('/project')).toEqual(['templates/']);
		expect(loadNaoignorePatterns('/project')).toEqual(['tests/']);
	});
});

/** Imports the tools module with the posix or win32 `path` implementation and an empty `fs` (no .naoignore). */
async function loadTools(variant: 'posix' | 'win32') {
	const statSync = () => {
		const err = new Error('ENOENT') as NodeJS.ErrnoException;
		err.code = 'ENOENT';
		throw err;
	};
	return importToolsWith(variant, {
		existsSync: () => false,
		readFileSync: () => '',
		realpathSync: statSync,
		statSync,
	});
}

/** Each `fs` read or stat call consumes the next file, the last one being repeated. */
async function loadToolsWithNaoignoreFiles(files: { content: string; mtimeMs: number; size?: number }[]) {
	let callIndex = 0;
	const nextFile = () => {
		const file = files[Math.min(callIndex, files.length - 1)];
		callIndex += 1;
		return file;
	};

	const statSync = () => {
		const file = nextFile();
		return { mtimeMs: file.mtimeMs, size: file.size ?? file.content.length };
	};
	return importToolsWith('posix', { existsSync: () => true, readFileSync: () => nextFile().content, statSync });
}

async function importToolsWith(variant: 'posix' | 'win32', fsFunctions: Record<string, unknown>) {
	vi.resetModules();

	const pathModule = await import('path');
	const impl = pathModule[variant];
	vi.doMock('path', () => ({ ...impl, default: impl }));
	vi.doMock('fs', () => ({ default: fsFunctions, ...fsFunctions }));

	const tools = await import('../../src/utils/tools');
	tools.clearNaoignoreCache();
	return tools;
}
