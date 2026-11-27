import { z } from 'zod';

export const skillNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes.');

export const USER_SKILL_SHARE_STATUSES = ['private', 'requested', 'accepted', 'declined'] as const;
export type UserSkillShareStatus = (typeof USER_SKILL_SHARE_STATUSES)[number];

/** A skill a member wrote for themselves: stored in nao, not in the context files, and only offered to its author. */
export interface PersonalSkill {
	name: string;
	description: string;
	body: string;
}
