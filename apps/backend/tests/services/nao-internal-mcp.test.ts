import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createPersonalSkill: vi.fn(),
	listPersonalSkills: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/services/user-skill.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/user-skill.service')>()),
	createPersonalSkill: mocks.createPersonalSkill,
	listPersonalSkills: mocks.listPersonalSkills,
}));

import { getTools } from '../../src/agents/tools';
import { createMcpCallTool } from '../../src/agents/tools/mcp-call';
import {
	callNaoInternalMcpTool,
	isMcpSpecsFolder,
	isNaoInternalMcpPath,
	listNaoInternalMcpFolder,
	listNaoInternalMcpSpecFilesUnder,
	listNaoInternalMcpTools,
	readNaoInternalMcpFile,
} from '../../src/services/nao-internal-mcp';
import type { ToolContext } from '../../src/types/tools';

const AUTHOR = { projectId: 'project-1', userId: 'user-1', canManagePersonalSkills: true };
const SKILL = { name: 'weekly-orders', description: 'My Monday numbers.', shareStatus: 'private' };
const SPECS_FOLDER = '/agent/mcps/nao__internal';

beforeEach(() => {
	mocks.createPersonalSkill.mockResolvedValue({ ...SKILL, body: 'Completed orders only.' });
	mocks.listPersonalSkills.mockResolvedValue([]);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('nao internal MCP server', () => {
	it('gives the personal skill tools to users who may write personal skills, and nothing to others', async () => {
		expect((await listNaoInternalMcpTools(AUTHOR)).map((tool) => tool.name)).toEqual([
			'list_personal_skills',
			'create_personal_skill',
		]);
		expect(await listNaoInternalMcpTools({ ...AUTHOR, canManagePersonalSkills: false })).toEqual([]);
		await expect(
			callNaoInternalMcpTool({ ...AUTHOR, canManagePersonalSkills: false }, 'list_personal_skills', {}),
		).rejects.toThrow('has no tool for this user');
	});

	it('serves one OpenAPI spec per tool from memory, to call through mcp_call', async () => {
		const entries = await listNaoInternalMcpFolder(AUTHOR, `${SPECS_FOLDER}/`);
		expect(entries.map((entry) => entry.path)).toEqual([
			`${SPECS_FOLDER}/list_personal_skills.json`,
			`${SPECS_FOLDER}/create_personal_skill.json`,
		]);

		const spec = JSON.parse(await readNaoInternalMcpFile(AUTHOR, `${SPECS_FOLDER}/create_personal_skill.json`));
		const operation = spec.paths['/tools/create_personal_skill'].post;
		expect(spec['x-mcp']).toMatchObject({ server: 'nao__internal', transport: 'in-process' });
		expect(operation.operationId).toBe('create_personal_skill');
		expect(operation.requestBody.content['application/json'].schema.required).toEqual([
			'name',
			'description',
			'instructions',
		]);
		await expect(readNaoInternalMcpFile(AUTHOR, `${SPECS_FOLDER}/missing.json`)).rejects.toThrow('File not found');
	});

	it('creates the personal skill of the run user', async () => {
		const result = await callNaoInternalMcpTool(AUTHOR, 'create_personal_skill', {
			name: 'weekly-orders',
			description: 'My Monday numbers.',
			instructions: 'Completed orders only.',
		});

		expect(mocks.createPersonalSkill).toHaveBeenCalledWith('project-1', 'user-1', {
			name: 'weekly-orders',
			description: 'My Monday numbers.',
			body: 'Completed orders only.',
		});
		expect(result).toMatchObject({ structuredContent: SKILL });
	});

	it('recognises its folder, and the folder of every server it shows up in', async () => {
		expect(isNaoInternalMcpPath(SPECS_FOLDER)).toBe(true);
		expect(isNaoInternalMcpPath(`${SPECS_FOLDER}/create_personal_skill.json`)).toBe(true);
		expect(isNaoInternalMcpPath('/agent/mcps/nao__internal_other/tool.json')).toBe(false);
		expect(isMcpSpecsFolder('/agent/mcps/')).toBe(true);
		expect(
			(await listNaoInternalMcpSpecFilesUnder(AUTHOR, `${SPECS_FOLDER}/list_personal_skills.json`)).map(
				(file) => file.virtualPath,
			),
		).toEqual([`${SPECS_FOLDER}/list_personal_skills.json`]);
	});
});

describe('nao internal MCP in the agent tools', () => {
	it('keeps the MCP tools for its users even when the project declares no MCP server', () => {
		expect(getTools(null, undefined, {})).not.toHaveProperty('mcp_call');
		expect(getTools(null, undefined, { naoInternalMcp: true })).toHaveProperty('mcp_call');
		expect(getTools(null, undefined, { naoInternalMcp: true, mcpEnabled: false })).not.toHaveProperty('mcp_call');
		expect(getTools(null, undefined, { naoInternalMcp: true, mcpServers: ['linear'] })).not.toHaveProperty(
			'mcp_call',
		);
	});

	it('routes mcp_call to the server in process, unless the run is restricted to other servers', async () => {
		const context = AUTHOR as unknown as ToolContext;
		const call = { server: 'nao__internal', tool: 'list_personal_skills', arguments: {} };

		await expect(executeMcpCall(null, call, context)).resolves.toMatchObject({ structuredContent: { skills: [] } });
		await expect(executeMcpCall(['linear'], call, context)).rejects.toThrow('not available in this context');
	});
});

function executeMcpCall(
	allowedServers: string[] | null,
	input: { server: string; tool: string; arguments: Record<string, unknown> },
	context: ToolContext,
) {
	const tool = createMcpCallTool(allowedServers) as unknown as {
		execute: (input: unknown, options: { experimental_context: ToolContext }) => Promise<unknown>;
	};
	return tool.execute(input, { experimental_context: context });
}
