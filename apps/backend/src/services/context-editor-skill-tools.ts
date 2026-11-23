import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import type { DBUserSkill } from '../db/abstractSchema';
import * as userSkillQueries from '../queries/user-skill.queries';
import type { UserSkillShareStatus } from '../types/user-skill';
import { createTool } from '../utils/tools';
import { createStrictFileAccess } from './context-explorer-access.service';
import { acceptShareRequest, declineShareRequest, requestPersonalSkillShare } from './user-skill.service';

interface ContextEditor {
	id: string;
	name: string;
	email: string;
}

interface PersonalSkillOutput {
	name: string;
	description: string;
	body: string;
	shareStatus: UserSkillShareStatus;
}

interface ShareRequestReviewOutput {
	requestId: string;
	decision: 'accept' | 'decline';
	/** The skill file added to the reviewer's changes when the request is accepted. */
	path: string | null;
}

const skillNameSchema = z.string().trim().min(1).max(64).describe('Name of the personal skill, e.g. weekly-orders.');

const updateInputSchema = z
	.object({
		name: skillNameSchema,
		description: z
			.string()
			.trim()
			.max(1_000)
			.optional()
			.describe('The new "when should nao use it" text, which decides when the agent picks the skill.'),
		body: z
			.string()
			.trim()
			.min(1)
			.max(50_000)
			.optional()
			.describe('The new instructions, in full: they replace the current ones.'),
	})
	.refine((input) => input.description !== undefined || input.body !== undefined, {
		message: 'Give a new description, new instructions, or both.',
	});

const shareInputSchema = z.object({
	name: skillNameSchema,
	note: z.string().trim().max(1_000).optional().describe('Why the team needs it, for the reviewer.'),
});

const reviewInputSchema = z.object({
	request_id: z.string().trim().min(1).describe('Id of the share request, as the hub page gives it.'),
	decision: z.enum(['accept', 'decline']),
});

/**
 * Tools on the user's own personal skills, which live in nao rather than in the context files, and on the requests
 * members sent to share theirs. The Context Hub chat is for admins and context admins, who review those requests.
 */
export function createContextEditorSkillTools(editor: ContextEditor) {
	return {
		read_personal_skill: createTool<{ name: string }, PersonalSkillOutput>({
			description: 'Read one of the user’s own personal skills: when nao uses it and its instructions.',
			inputSchema: z.object({ name: skillNameSchema }),
			execute: async ({ name }, context) => toOutput(await getOwnSkill(context.projectId, editor.id, name)),
		}),
		update_personal_skill: createTool<z.infer<typeof updateInputSchema>, PersonalSkillOutput>({
			description:
				'Change one of the user’s own personal skills: its "when should nao use it" text, its instructions, or both. It takes effect in their next chat, with no publishing.',
			inputSchema: updateInputSchema,
			execute: async ({ name, description, body }, context) => {
				await getOwnSkill(context.projectId, editor.id, name);
				const skill = await userSkillQueries.updateUserSkill(context.projectId, editor.id, name, {
					...(description !== undefined && { description }),
					...(body !== undefined && { body }),
				});
				return toOutput(skill ?? throwSkillNotFound(name));
			},
		}),
		request_personal_skill_share: createTool<z.infer<typeof shareInputSchema>, PersonalSkillOutput>({
			description:
				'Ask the context admins to share one of the user’s own personal skills with everyone. Only when the user asks for it.',
			inputSchema: shareInputSchema,
			execute: async ({ name, note }, context) =>
				toOutput(await requestPersonalSkillShare(context.projectId, editor.id, name, note || null)),
		}),
		review_share_request: createTool<z.infer<typeof reviewInputSchema>, ShareRequestReviewOutput>({
			description:
				'Accept or decline a member’s request to share a personal skill. Accepting adds the skill as agent/skills/<name>.md to the user’s changes, shared once they publish. Only when the user decides.',
			inputSchema: reviewInputSchema,
			execute: async ({ request_id, decision }, context) => {
				if (decision === 'decline') {
					await declineShareRequest(context.projectId, request_id);
					return { requestId: request_id, decision, path: null };
				}
				const access = await createStrictFileAccess(context.projectId, context.projectFolder, editor);
				const { path } = await acceptShareRequest(context.projectId, request_id, access);
				return { requestId: request_id, decision, path };
			},
		}),
	};
}

async function getOwnSkill(projectId: string, userId: string, name: string): Promise<DBUserSkill> {
	return (await userSkillQueries.getUserSkill(projectId, userId, name)) ?? throwSkillNotFound(name);
}

function toOutput(skill: DBUserSkill): PersonalSkillOutput {
	return { name: skill.name, description: skill.description, body: skill.body, shareStatus: skill.shareStatus };
}

function throwSkillNotFound(name: string): never {
	throw new TRPCError({ code: 'NOT_FOUND', message: `You have no personal skill called '${name}'.` });
}
