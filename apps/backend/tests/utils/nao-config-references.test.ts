import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import { holdsFileReference, resolveFileReferences } from '../../src/utils/nao-config-references';
import { logger } from '../helpers/logger-mock';
import { useTemporaryFolders } from '../helpers/temporary-folders';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const createTemporaryFolder = useTemporaryFolders();

const NESTED_ALIASES = [
	'level_0: &level_0 [analytics.orders, analytics.orders]',
	...Array.from(
		{ length: 20 },
		(_, level) => `level_${level + 1}: &level_${level + 1} [*level_${level}, *level_${level}]`,
	),
].join('\n');
const ALIAS_TO_ITS_OWN_PARENT = 'tables: &tables [*tables]';

describe('resolveFileReferences', () => {
	it.each([
		{ reason: 'nested aliases', config: yaml.load(NESTED_ALIASES), file: '- analytics.orders\n' },
		{
			reason: 'an alias to its own parent',
			config: yaml.load(ALIAS_TO_ITS_OWN_PARENT),
			file: '- analytics.orders\n',
		},
		{
			reason: 'a file with nested aliases',
			config: { include: { from_file: 'tables.yml' } },
			file: NESTED_ALIASES,
		},
		{
			reason: 'a file with an alias to its own parent',
			config: { include: { from_file: 'tables.yml' } },
			file: ALIAS_TO_ITS_OWN_PARENT,
		},
	])('refuses a config that $reason would expand beyond the node budget', ({ config, file }) => {
		const project = createProject({ 'tables.yml': file });

		expect(() => resolveFileReferences(config, project)).toThrow('more than 100000 values');
	});

	it('keeps a config whose aliases stay within the node budget', () => {
		const config = yaml.load('shared: &shared [analytics.orders]\ninclude: *shared\nexclude: *shared\n');

		expect(resolveFileReferences(config, createProject({}))).toEqual({
			shared: ['analytics.orders'],
			include: ['analytics.orders'],
			exclude: ['analytics.orders'],
		});
	});

	it('replaces a reference by the content of its file', () => {
		const project = createProject({ 'repos/business_context/tables.yml': '- analytics.orders\n' });
		const config = {
			databases: [{ name: 'warehouse', include: { from_file: 'repos/business_context/tables.yml' } }],
			since: new Date(0),
		};

		expect(resolveFileReferences(config, project)).toEqual({
			databases: [{ name: 'warehouse', include: ['analytics.orders'] }],
			since: new Date(0),
		});
	});

	it('trims the path of a reference, as the CLI does', () => {
		const project = createProject({ 'tables.yml': '- analytics.orders\n' });

		expect(resolveFileReferences({ include: { from_file: ' tables.yml ' } }, project)).toEqual({
			include: ['analytics.orders'],
		});
	});

	it.each([
		{ reason: 'does not exist', file: 'missing.yml', warning: 'ENOENT' },
		{ reason: 'is reached through a parent folder', file: 'folder/../tables.yml', warning: "no '..'" },
		{ reason: 'is given as an absolute path', file: '/tables.yml', warning: 'relative path' },
		{ reason: 'is linked from outside the project', file: 'linked/outside.yml', warning: 'outside the project' },
		{ reason: 'holds a secret reference', file: 'secret.yml', warning: 'secret reference' },
		{ reason: 'holds an escaped secret reference', file: 'escaped.yml', warning: 'secret reference' },
		{ reason: 'holds another reference', file: 'nested.yml', warning: 'another from_file' },
	])('leaves out a reference whose file $reason', ({ file, warning }) => {
		const project = createProject({
			'../outside.yml': '- analytics.orders\n',
			'tables.yml': '- analytics.orders\n',
			'folder/tables.yml': '- analytics.orders\n',
			'secret.yml': '- "{{ env(\'SECRET\') }}"\n',
			'escaped.yml': '- "\\u007b\\u007b env(\'SECRET\') }}"\n',
			'nested.yml': '- from_file: tables.yml\n',
		});
		fs.symlinkSync(path.dirname(project), path.join(project, 'linked'));
		logger.warn.mockClear();

		const resolved = resolveFileReferences({ name: 'warehouse', include: { from_file: file } }, project);

		expect(resolved).toEqual({ name: 'warehouse' });
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(warning), { source: 'system' });
	});
});

describe('holdsFileReference', () => {
	it('finds no reference under an alias to its own parent', () => {
		expect(holdsFileReference(yaml.load(ALIAS_TO_ITS_OWN_PARENT))).toBe(false);
	});
});

function createProject(files: Record<string, string>): string {
	const project = path.join(createTemporaryFolder('nao-config-references-'), 'project');
	for (const [file, content] of Object.entries(files)) {
		const filePath = path.join(project, file);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
	return project;
}
