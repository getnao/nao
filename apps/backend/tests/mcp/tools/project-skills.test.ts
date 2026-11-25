import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	projectPath: '',
	buildMcpToolContext: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs')>();
	return { ...actual, watch: vi.fn(() => ({ close: vi.fn() })) };
});
vi.mock('../../../src/db/db', () => ({ db: {} }));
vi.mock('../../../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/queries/project.queries', () => ({
	retrieveProjectById: vi.fn(async (projectId: string) => ({ id: projectId, path: mocks.projectPath })),
}));
vi.mock('../../../src/services/agent', () => ({ buildMcpToolContext: mocks.buildMcpToolContext }));
vi.mock('../../../src/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerProjectSkillTools } from '../../../src/mcp/tools/project-skills';
import { skillService } from '../../../src/services/skill';
import type {
	ResolvedFilesContextAccess,
	ResolvedSkillsAccess,
} from '../../../src/services/user-group-context-access.service';
import { createToolContext } from '../../helpers/tool-context';

const PROJECT_ID = 'mcp-project-skills';
const NOT_FOUND = "There is no skill called '%s'. Call `list_nao_skills` to see the available ones.";
const connections: Array<{ client: Client; server: McpServer }> = [];
let projectRoot: string;

beforeAll(async () => {
	projectRoot = mkdtempSync(join(tmpdir(), 'nao-mcp-project-skills-'));
	const skillsFolder = join(projectRoot, 'agent', 'skills');
	mkdirSync(skillsFolder, { recursive: true });
	writeFileSync(
		join(skillsFolder, 'revenue.md'),
		'---\nname: revenue\ndescription: How to compute revenue.\n---\n\nAlways use net revenue.\n',
	);
	writeFileSync(
		join(skillsFolder, 'churn.md'),
		'---\nname: churn\ndescription: How to compute churn.\n---\n\nCount a customer once.\n',
	);
	writeFileSync(
		join(skillsFolder, 'broken.md'),
		'---\nname: broken\ndescription: [mcp project skills unclosed\n---\n\nBody\n',
	);
	mocks.projectPath = projectRoot;
	await skillService.initializeSkills(PROJECT_ID);
});

afterAll(() => {
	rmSync(projectRoot, { recursive: true, force: true });
});

beforeEach(() => {
	mockAccess({ skillsAccess: { mode: 'all' } });
});

afterEach(async () => {
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP list_nao_skills', () => {
	it('lists the project skills with their descriptions, skipping skills that failed to load', async () => {
		expect(skillService.getSkillLoadErrors(PROJECT_ID)).toHaveLength(1);

		const result = await callTool('list_nao_skills', {});

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			skills: expect.arrayContaining([
				{ name: 'revenue', description: 'How to compute revenue.' },
				{ name: 'churn', description: 'How to compute churn.' },
			]),
		});
		expect((result.structuredContent as { skills: unknown[] }).skills).toHaveLength(2);
	});

	it('lists only the skills granted to the caller', async () => {
		mockAccess({ skillsAccess: restrictedSkills(['revenue']) });

		const result = await callTool('list_nao_skills', {});

		expect(result.structuredContent).toEqual({
			skills: [{ name: 'revenue', description: 'How to compute revenue.' }],
		});
	});

	it('does not list a granted skill whose file the caller may not read', async () => {
		mockAccess({ skillsAccess: { mode: 'all' }, filesContextAccess: docsOnlyFiles() });

		const result = await callTool('list_nao_skills', {});

		expect(result.structuredContent).toEqual({ skills: [] });
	});
});

describe('MCP get_nao_skill', () => {
	it('returns the instructions without the frontmatter', async () => {
		const result = await callTool('get_nao_skill', { name: 'revenue' });

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			name: 'revenue',
			description: 'How to compute revenue.',
			instructions: 'Always use net revenue.',
		});
	});

	it('answers a skill that is not granted exactly like an unknown name', async () => {
		mockAccess({ skillsAccess: restrictedSkills(['revenue']) });

		const notGranted = await callTool('get_nao_skill', { name: 'churn' });
		const unknown = await callTool('get_nao_skill', { name: 'nope' });

		expect(notGranted.isError).toBe(true);
		expect(notGranted.content).toEqual([{ type: 'text', text: NOT_FOUND.replace('%s', 'churn') }]);
		expect(unknown.content).toEqual([{ type: 'text', text: NOT_FOUND.replace('%s', 'nope') }]);
	});

	it('answers a granted skill whose file is not readable like an unknown name', async () => {
		mockAccess({ skillsAccess: { mode: 'all' }, filesContextAccess: docsOnlyFiles() });

		const result = await callTool('get_nao_skill', { name: 'revenue' });

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([{ type: 'text', text: NOT_FOUND.replace('%s', 'revenue') }]);
	});

	it('answers a skill that failed to load like an unknown name', async () => {
		const result = await callTool('get_nao_skill', { name: 'broken' });

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([{ type: 'text', text: NOT_FOUND.replace('%s', 'broken') }]);
	});
});

function mockAccess(overrides: {
	skillsAccess: ResolvedSkillsAccess;
	filesContextAccess?: ResolvedFilesContextAccess;
}): void {
	mocks.buildMcpToolContext.mockResolvedValue(createToolContext({ projectId: PROJECT_ID, ...overrides }));
}

function restrictedSkills(skills: string[]): ResolvedSkillsAccess {
	return { mode: 'restricted', skills, grantedFiles: skills.map((skill) => `agent/skills/${skill}.md`) };
}

function docsOnlyFiles(): ResolvedFilesContextAccess {
	return { enforced: true, access: { mode: 'restricted', grants: [{ kind: 'folder', path: 'docs' }] } };
}

async function callTool(name: string, args: Record<string, unknown>) {
	const server = new McpServer({ name: 'test', version: '0.0.0' });
	registerProjectSkillTools(server, {
		userId: 'user-1',
		projectId: PROJECT_ID,
		role: 'user',
		settings: { enabled: true, subAgentModeEnabled: false, contextLayerModeEnabled: false },
		chartDataMode: false,
		storyCreationEnabled: false,
		customStoryCreationEnabled: false,
	});
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	connections.push({ client, server });
	return client.callTool({ name, arguments: args });
}
