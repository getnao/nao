import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Dynamically imports the tools module with a mocked `path` implementation
 * (posix or win32) and a stubbed `fs` (no .naoignore files on disk).
 */
async function loadTools(variant: 'posix' | 'win32') {
	vi.resetModules();

	const pathModule = await import('path');
	const impl = pathModule[variant];
	vi.doMock('path', () => ({ ...impl, default: impl }));
	vi.doMock('fs', () => ({
		default: { existsSync: () => false, readFileSync: () => '' },
		existsSync: () => false,
		readFileSync: () => '',
	}));

	const tools = await import('../src/utils/tools');
	tools.clearNaoignoreCache();
	return tools;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

// ---------------------------------------------------------------------------
// toRealPath
// ---------------------------------------------------------------------------

describe('toRealPath', () => {
	describe('posix', () => {
		it('resolves virtual path with leading slash', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(toRealPath('/databases', '/home/user/project')).toBe('/home/user/project/databases');
		});

		it('resolves virtual path without leading slash', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(toRealPath('agent', '/home/user/project')).toBe('/home/user/project/agent');
		});

		it('resolves root virtual path to project folder', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(toRealPath('/', '/home/user/project')).toBe('/home/user/project');
		});

		it('resolves nested paths', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(toRealPath('/databases/schemas/public.sql', '/home/user/project')).toBe(
				'/home/user/project/databases/schemas/public.sql',
			);
		});

		it('rejects path traversal with ..', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(() => toRealPath('/../etc/passwd', '/home/user/project')).toThrow('outside the project folder');
		});

		it('rejects path traversal with relative ..', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(() => toRealPath('../etc/passwd', '/home/user/project')).toThrow('outside the project folder');
		});

		it('rejects excluded .meta directory', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(() => toRealPath('/.meta/something', '/home/user/project')).toThrow('excluded directory');
		});

		it('normalizes trailing slash on project folder', async () => {
			const { toRealPath } = await loadTools('posix');
			expect(toRealPath('/databases', '/home/user/project/')).toBe('/home/user/project/databases');
		});
	});

	describe('win32', () => {
		it('resolves with backslash project folder', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(toRealPath('/databases', 'C:\\Users\\user\\project')).toBe('C:\\Users\\user\\project\\databases');
		});

		it('resolves with forward-slash project folder', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(toRealPath('/databases', 'C:/Users/user/project')).toBe('C:\\Users\\user\\project\\databases');
		});

		it('resolves without leading slash and forward-slash project folder', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(toRealPath('agent', 'C:/Users/user/project')).toBe('C:\\Users\\user\\project\\agent');
		});

		it('resolves root virtual path to project folder', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(toRealPath('/', 'C:\\Users\\user\\project')).toBe('C:\\Users\\user\\project');
		});

		it('resolves nested paths with forward-slash project folder', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(toRealPath('/databases/schemas/public.sql', 'C:/Users/user/project')).toBe(
				'C:\\Users\\user\\project\\databases\\schemas\\public.sql',
			);
		});

		it('rejects path traversal', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(() => toRealPath('/../something', 'C:\\Users\\user\\project')).toThrow('outside the project folder');
		});

		it('rejects excluded .meta directory', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(() => toRealPath('/.meta/data', 'C:\\Users\\user\\project')).toThrow('excluded directory');
		});

		it('handles mixed separators in project folder', async () => {
			const { toRealPath } = await loadTools('win32');
			expect(toRealPath('/agent', 'C:/Users\\user/project')).toBe('C:\\Users\\user\\project\\agent');
		});
	});
});

// ---------------------------------------------------------------------------
// toVirtualPath
// ---------------------------------------------------------------------------

describe('toVirtualPath', () => {
	describe('posix', () => {
		it('converts real path to virtual path', async () => {
			const { toVirtualPath } = await loadTools('posix');
			expect(toVirtualPath('/home/user/project/databases', '/home/user/project')).toBe('/databases');
		});

		it('converts project folder itself to /', async () => {
			const { toVirtualPath } = await loadTools('posix');
			expect(toVirtualPath('/home/user/project', '/home/user/project')).toBe('/');
		});

		it('converts nested real path to virtual path', async () => {
			const { toVirtualPath } = await loadTools('posix');
			expect(toVirtualPath('/home/user/project/databases/schemas/public.sql', '/home/user/project')).toBe(
				'/databases/schemas/public.sql',
			);
		});

		it('rejects paths outside project folder', async () => {
			const { toVirtualPath } = await loadTools('posix');
			expect(() => toVirtualPath('/etc/passwd', '/home/user/project')).toThrow('outside the project folder');
		});
	});

	describe('win32', () => {
		it('converts real path using forward slashes in output', async () => {
			const { toVirtualPath } = await loadTools('win32');
			expect(toVirtualPath('C:\\Users\\user\\project\\databases', 'C:\\Users\\user\\project')).toBe('/databases');
		});

		it('converts nested path using forward slashes in output', async () => {
			const { toVirtualPath } = await loadTools('win32');
			expect(
				toVirtualPath('C:\\Users\\user\\project\\databases\\schemas\\public.sql', 'C:\\Users\\user\\project'),
			).toBe('/databases/schemas/public.sql');
		});

		it('converts project folder itself to /', async () => {
			const { toVirtualPath } = await loadTools('win32');
			expect(toVirtualPath('C:\\Users\\user\\project', 'C:\\Users\\user\\project')).toBe('/');
		});

		it('works with forward-slash project folder', async () => {
			const { toVirtualPath } = await loadTools('win32');
			expect(toVirtualPath('C:\\Users\\user\\project\\agent', 'C:/Users/user/project')).toBe('/agent');
		});

		it('rejects paths outside project folder', async () => {
			const { toVirtualPath } = await loadTools('win32');
			expect(() => toVirtualPath('C:\\Windows\\system32', 'C:\\Users\\user\\project')).toThrow(
				'outside the project folder',
			);
		});

		it('returns forward slashes even for deeply nested Windows paths', async () => {
			const { toVirtualPath } = await loadTools('win32');
			expect(toVirtualPath('C:\\Users\\user\\project\\a\\b\\c\\d.txt', 'C:\\Users\\user\\project')).toBe(
				'/a/b/c/d.txt',
			);
		});
	});
});

// ---------------------------------------------------------------------------
// isWithinProjectFolder
// ---------------------------------------------------------------------------

describe('isWithinProjectFolder', () => {
	describe('posix', () => {
		it('returns true for paths inside project folder', async () => {
			const { isWithinProjectFolder } = await loadTools('posix');
			expect(isWithinProjectFolder('/home/user/project/databases', '/home/user/project')).toBe(true);
		});

		it('returns true for the project folder itself', async () => {
			const { isWithinProjectFolder } = await loadTools('posix');
			expect(isWithinProjectFolder('/home/user/project', '/home/user/project')).toBe(true);
		});

		it('returns false for paths outside project folder', async () => {
			const { isWithinProjectFolder } = await loadTools('posix');
			expect(isWithinProjectFolder('/etc/passwd', '/home/user/project')).toBe(false);
		});

		it('returns false for sibling with matching prefix', async () => {
			const { isWithinProjectFolder } = await loadTools('posix');
			expect(isWithinProjectFolder('/home/user/project-other/file', '/home/user/project')).toBe(false);
		});

		it('returns false for excluded .meta directory', async () => {
			const { isWithinProjectFolder } = await loadTools('posix');
			expect(isWithinProjectFolder('/home/user/project/.meta/data', '/home/user/project')).toBe(false);
		});
	});

	describe('win32', () => {
		it('returns true for paths inside project folder', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('C:\\Users\\user\\project\\databases', 'C:\\Users\\user\\project')).toBe(true);
		});

		it('returns true with forward-slash project folder', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('C:\\Users\\user\\project\\databases', 'C:/Users/user/project')).toBe(true);
		});

		it('returns true for the project folder itself', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('C:\\Users\\user\\project', 'C:\\Users\\user\\project')).toBe(true);
		});

		it('returns true for project folder itself with mixed slashes', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('C:\\Users\\user\\project', 'C:/Users/user/project')).toBe(true);
		});

		it('returns false for paths outside project folder', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('C:\\Windows\\system32', 'C:\\Users\\user\\project')).toBe(false);
		});

		it('returns false for sibling with matching prefix', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('C:\\Users\\user\\project-other\\file', 'C:\\Users\\user\\project')).toBe(
				false,
			);
		});

		it('returns false for different drive', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('D:\\project\\file', 'C:\\Users\\user\\project')).toBe(false);
		});

		it('returns false for excluded .meta directory', async () => {
			const { isWithinProjectFolder } = await loadTools('win32');
			expect(isWithinProjectFolder('C:\\Users\\user\\project\\.meta\\data', 'C:\\Users\\user\\project')).toBe(
				false,
			);
		});
	});
});
