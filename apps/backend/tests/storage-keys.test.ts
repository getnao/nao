import { describe, expect, it } from 'vitest';

import {
	projectRoot,
	relativePathFromKey,
	sanitizeRelativePath,
	scopedKey,
	scopeRoot,
	userIdFromKey,
} from '../src/services/storage/keys';

const scope = { projectId: 'proj-1', userId: 'user-1' };

describe('projectRoot', () => {
	it('covers every user space of the project', () => {
		expect(projectRoot('proj-1')).toBe('projects/proj-1');
		expect(scopeRoot(scope).startsWith(`${projectRoot('proj-1')}/`)).toBe(true);
	});

	it('rejects an unsafe project id', () => {
		expect(() => projectRoot('../other')).toThrow('Invalid project id');
		expect(() => projectRoot('')).toThrow('Missing project id');
	});
});

describe('userIdFromKey', () => {
	it('reads the owner of a scoped key', () => {
		expect(userIdFromKey(scopedKey(scope, 'reports/q1.csv'))).toBe('user-1');
	});

	it('ignores keys that are not inside a user space', () => {
		expect(userIdFromKey('projects/proj-1/users/user-1')).toBeNull();
		expect(userIdFromKey('projects/proj-1/shared/notes.md')).toBeNull();
		expect(userIdFromKey('.nao-storage-health')).toBeNull();
	});
});

describe('scopeRoot', () => {
	it('namespaces by project then user', () => {
		expect(scopeRoot(scope)).toBe('projects/proj-1/users/user-1');
	});

	it('rejects identifiers containing separators', () => {
		expect(() => scopeRoot({ ...scope, projectId: '../other' })).toThrow('Invalid project id');
		expect(() => scopeRoot({ ...scope, userId: 'a/b' })).toThrow('Invalid user id');
	});

	it('rejects missing identifiers', () => {
		expect(() => scopeRoot({ ...scope, projectId: '' })).toThrow('Missing project id');
		expect(() => scopeRoot({ ...scope, userId: '  ' })).toThrow('Missing user id');
	});
});

describe('scopedKey', () => {
	it('builds a key inside the scope', () => {
		expect(scopedKey(scope, 'reports/q1.csv')).toBe('projects/proj-1/users/user-1/reports/q1.csv');
	});

	it('ignores leading and trailing slashes', () => {
		expect(scopedKey(scope, '/reports/q1.csv/')).toBe('projects/proj-1/users/user-1/reports/q1.csv');
	});

	it('collapses repeated slashes', () => {
		expect(scopedKey(scope, 'reports//q1.csv')).toBe('projects/proj-1/users/user-1/reports/q1.csv');
	});

	it('rejects keys longer than the S3 limit', () => {
		expect(() => scopedKey(scope, 'a'.repeat(1100))).toThrow('too long');
	});
});

describe('sanitizeRelativePath', () => {
	it('keeps a plain nested path', () => {
		expect(sanitizeRelativePath('a/b/c.txt')).toBe('a/b/c.txt');
	});

	it('allows dotfiles and names containing dots', () => {
		expect(sanitizeRelativePath('.hidden/v1.2.3/file.tar.gz')).toBe('.hidden/v1.2.3/file.tar.gz');
	});

	it.each([
		['..', "may not contain '..' segments"],
		['../etc/passwd', "may not contain '..' segments"],
		['reports/../../etc/passwd', "may not contain '..' segments"],
		['reports/./q1.csv', "may not contain '.' segments"],
		['/', 'Path is required'],
		['', 'Path is required'],
		['   ', 'Path is required'],
		['reports/ /q1.csv', 'blank segments'],
		['reports\\q1.csv', 'may not contain backslashes'],
		['reports/q1\0.csv', 'null bytes'],
		['reports/q1\n.csv', 'control characters'],
	])('rejects %j', (input, message) => {
		expect(() => sanitizeRelativePath(input)).toThrow(message);
	});

	it('rejects traversal that would escape after normalisation', () => {
		expect(() => scopedKey(scope, 'a/../../../../etc/passwd')).toThrow("may not contain '..' segments");
	});
});

describe('relativePathFromKey', () => {
	it('round-trips a scoped key', () => {
		const key = scopedKey(scope, 'reports/q1.csv');
		expect(relativePathFromKey(scope, key)).toBe('reports/q1.csv');
	});

	it('rejects a key from another scope', () => {
		const key = scopedKey({ projectId: 'proj-2', userId: 'user-1' }, 'reports/q1.csv');
		expect(() => relativePathFromKey(scope, key)).toThrow('does not belong to this scope');
	});

	it('rejects a key from another user in the same project', () => {
		const key = scopedKey({ projectId: 'proj-1', userId: 'user-2' }, 'reports/q1.csv');
		expect(() => relativePathFromKey(scope, key)).toThrow('does not belong to this scope');
	});
});
