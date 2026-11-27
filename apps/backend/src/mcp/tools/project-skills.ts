import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildMcpToolContext } from '../../services/agent';
import { isProjectSkillAllowed } from '../../services/project-skill-access.service';
import { type Skill, skillService } from '../../services/skill';
import type { McpToolContext } from '../../types/tools';
import type { McpContext } from '../logging';
import { jsonToolResult, registerMcpTool } from './register-mcp-tool';

const LIST_NAO_SKILLS_DESCRIPTION =
	'List the project skills you can use in nao: instructions the team wrote for recurring data questions, ' +
	'with when each one applies.\n\n' +
	'USE WHEN: before answering a data question, to check whether the team has a skill for it. ' +
	'Then call `get_nao_skill` with its name and follow the instructions.';

const GET_NAO_SKILL_DESCRIPTION =
	'Get the full instructions of one project skill in nao: definitions, steps and answer format.\n\n' +
	'USE WHEN: `list_nao_skills` shows a skill whose description matches the question. ' +
	'Call `list_nao_skills` first to find the name.';

const SKILL_SUMMARY_SCHEMA = z.object({
	name: z.string(),
	description: z.string().describe('When the skill applies.'),
});

export function registerProjectSkillTools(server: McpServer, ctx: McpContext): void {
	registerListNaoSkills(server, ctx);
	registerGetNaoSkill(server, ctx);
}

function registerListNaoSkills(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'list_nao_skills',
		title: 'List Project Skills',
		description: LIST_NAO_SKILLS_DESCRIPTION,
		inputSchema: {},
		outputSchema: { skills: z.array(SKILL_SUMMARY_SCHEMA) },
		handler: async () => {
			const skills = await listAllowedSkills(ctx);
			return jsonToolResult({ skills: skills.map(({ name, description }) => ({ name, description })) });
		},
	});
}

function registerGetNaoSkill(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'get_nao_skill',
		title: 'Get Project Skill',
		description: GET_NAO_SKILL_DESCRIPTION,
		inputSchema: { name: z.string().trim().min(1).max(200).describe('A skill name from `list_nao_skills`.') },
		outputSchema: { ...SKILL_SUMMARY_SCHEMA.shape, instructions: z.string() },
		errorMessage: () => 'get_nao_skill failed. Please try again.',
		handler: async ({ name }) => {
			const context = await buildSkillAccessContext(ctx);
			const skill = skillService.getSkill(ctx.projectId, name);
			const instructions =
				skill && isProjectSkillAllowed(skill, context)
					? skillService.getSkillBody(ctx.projectId, skill.name)
					: null;
			if (!skill || !instructions) {
				return unknownSkillResult(name);
			}
			return jsonToolResult({ name: skill.name, description: skill.description, instructions });
		},
	});
}

async function listAllowedSkills(ctx: McpContext): Promise<Skill[]> {
	const context = await buildSkillAccessContext(ctx);
	return skillService.getSkills(ctx.projectId).filter((skill) => isProjectSkillAllowed(skill, context));
}

async function buildSkillAccessContext(ctx: McpContext): Promise<McpToolContext> {
	const [context] = await Promise.all([
		buildMcpToolContext({ projectId: ctx.projectId, userId: ctx.userId }),
		skillService.initializeSkills(ctx.projectId),
	]);
	return context;
}

function unknownSkillResult(name: string) {
	return {
		content: [
			{
				type: 'text' as const,
				text: `There is no skill called '${name}'. Call \`list_nao_skills\` to see the available ones.`,
			},
		],
		isError: true,
	};
}
