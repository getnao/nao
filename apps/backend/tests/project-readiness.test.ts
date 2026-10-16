import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { assessProjectReadiness } from '../src/utils/project-readiness';

describe('assessProjectReadiness', () => {
	it('rejects a directory at the nao config path', () => {
		const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-readiness-'));
		try {
			fs.mkdirSync(path.join(projectPath, 'nao_config.yaml'));

			expect(assessProjectReadiness({ path: projectPath, envVars: {} })).toMatchObject({
				ready: false,
				naoConfigExists: false,
			});
		} finally {
			fs.rmSync(projectPath, { recursive: true, force: true });
		}
	});

	it('rejects a nao config that cannot be read', () => {
		const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-readiness-'));
		const configPath = path.join(projectPath, 'nao_config.yaml');
		fs.writeFileSync(configPath, 'project_name: test');
		const readFile = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
			throw new Error('EACCES');
		});
		try {
			expect(assessProjectReadiness({ path: projectPath, envVars: {} })).toMatchObject({
				ready: false,
				naoConfigExists: false,
			});
		} finally {
			readFile.mockRestore();
			fs.rmSync(projectPath, { recursive: true, force: true });
		}
	});

	it('reports missing MCP variables without a nao config', () => {
		const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-readiness-'));
		try {
			const mcpDirectory = path.join(projectPath, 'agent', 'mcps');
			fs.mkdirSync(mcpDirectory, { recursive: true });
			fs.writeFileSync(
				path.join(mcpDirectory, 'mcp.json'),
				JSON.stringify({ mcpServers: { dbt: { env: { DBT_TOKEN: '${DBT_TOKEN}' } } } }),
			);

			expect(assessProjectReadiness({ path: projectPath, envVars: {} })).toMatchObject({
				ready: false,
				directoryExists: true,
				naoConfigExists: false,
				requiredEnvVars: ['DBT_TOKEN'],
				missingEnvVars: ['DBT_TOKEN'],
			});
		} finally {
			fs.rmSync(projectPath, { recursive: true, force: true });
		}
	});
});
