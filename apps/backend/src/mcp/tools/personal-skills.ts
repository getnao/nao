import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { canRoleManagePersonalSkills } from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hasUserGroupFeature } from '../../services/user-group-feature-access.service';
import { createPersonalSkill, listPersonalSkills } from '../../services/user-skill.service';
import { USER_SKILL_SHARE_STATUSES } from '../../types/user-skill';
import type { McpContext } from '../logging';
import { jsonToolResult, registerMcpTool } from './register-mcp-tool';

const CREATE_PERSONAL_SKILL_DESCRIPTION =
	'Create a personal skill for the user in nao: instructions nao follows for one kind of request, only for this user. ' +
	'It works in their next nao chat, picked from its description or typed as `/<name>`, with no review or publishing.\n\n' +
	'USE WHEN: the user asks to save how they want a recurring request answered, like their Monday numbers.\n' +
	'Call `list_personal_skills` first: a name already taken by one of their skills or a project skill is refused.';

const LIST_PERSONAL_SKILLS_DESCRIPTION =
	'List the user’s own personal skills in nao, with when nao uses each one and whether they asked to share it.';

const SKILL_SUMMARY_SCHEMA = z.object({
	name: z.string(),
	description: z.string().describe('When nao uses the skill.'),
	shareStatus: z
		.enum(USER_SKILL_SHARE_STATUSES)
		.describe('`private`, or where a request to share it with the team stands.'),
});

/**
 * Personal skills over MCP follow the app: admins and context admins always write them, members when one of their
 * groups grants personal skills.
 */
export async function registerPersonalSkillTools(server: McpServer, ctx: McpContext): Promise<void> {
	const groupsGrantPersonalSkills =
		ctx.role === 'user' && (await hasUserGroupFeature(ctx.projectId, ctx.userId, 'personalSkills'));
	if (!canRoleManagePersonalSkills(ctx.role, groupsGrantPersonalSkills)) {
		return;
	}
	registerListPersonalSkills(server, ctx);
	registerCreatePersonalSkill(server, ctx);
}

function registerListPersonalSkills(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'list_personal_skills',
		title: 'List Personal Skills',
		description: LIST_PERSONAL_SKILLS_DESCRIPTION,
		inputSchema: {},
		outputSchema: { skills: z.array(SKILL_SUMMARY_SCHEMA) },
		handler: async () => {
			const skills = await listPersonalSkills(ctx.projectId, ctx.userId);
			return jsonToolResult({
				skills: skills.map(({ name, description, shareStatus }) => ({ name, description, shareStatus })),
			});
		},
	});
}

function registerCreatePersonalSkill(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'create_personal_skill',
		title: 'Create Personal Skill',
		description: CREATE_PERSONAL_SKILL_DESCRIPTION,
		inputSchema: {
			name: z
				.string()
				.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
				.max(64)
				.describe(
					'Lowercase letters, digits and dashes, e.g. `weekly-orders-by-store`: the user types `/<name>`.',
				),
			description: z
				.string()
				.max(1_000)
				.describe('When nao should use it, e.g. "When I ask for my Monday numbers": nao picks it from this.'),
			instructions: z
				.string()
				.min(1)
				.max(50_000)
				.describe('What nao does when it uses the skill: definitions, steps and answer format, in Markdown.'),
		},
		outputSchema: SKILL_SUMMARY_SCHEMA.shape,
		errorMessage: (error) =>
			error instanceof TRPCError && error.code === 'CONFLICT'
				? error.message
				: 'create_personal_skill failed. Please try again.',
		handler: async ({ name, description, instructions }) => {
			const skill = await createPersonalSkill(ctx.projectId, ctx.userId, {
				name,
				description: description.trim(),
				body: instructions.trim(),
			});
			return jsonToolResult({ name: skill.name, description: skill.description, shareStatus: skill.shareStatus });
		},
	});
}
