import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveFileReferences } from '../../src/utils/nao-config-references';
import { logger } from '../helpers/logger-mock';
import { useTemporaryFolders } from '../helpers/temporary-folders';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const createTemporaryFolder = useTemporaryFolders();

describe('resolveFileReferences', () => {
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

	it.each([
		{ reason: 'does not exist', file: 'missing.yml', warning: 'ENOENT' },
		{ reason: 'sits outside the project', file: '../outside.yml', warning: 'outside the project' },
		{ reason: 'holds a secret reference', file: 'secret.yml', warning: 'secret reference' },
		{ reason: 'holds another reference', file: 'nested.yml', warning: 'another from_file' },
	])('leaves out a reference whose file $reason', ({ file, warning }) => {
		const project = createProject({
			'../outside.yml': '- analytics.orders\n',
			'secret.yml': '- "{{ env(\'SECRET\') }}"\n',
			'nested.yml': '- from_file: tables.yml\n',
		});
		logger.warn.mockClear();

		const resolved = resolveFileReferences({ name: 'warehouse', include: { from_file: file } }, project);

		expect(resolved).toEqual({ name: 'warehouse' });
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(warning), { source: 'system' });
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
