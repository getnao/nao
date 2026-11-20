import { excelSkill } from './excel.skill';
import { pdfSkill } from './pdf.skill';
import { storyKitSkill } from './story-kit.skill';
import type { InternalSkill } from './types';

export { storyKitSkill } from './story-kit.skill';
export type { InternalSkill, SkillCapabilities } from './types';

const INTERNAL_SKILLS: InternalSkill[] = [excelSkill, pdfSkill, storyKitSkill];

/** Catalogued in the system prompt so the agent knows what it can load, and when. */
export const listInternalSkills = (): InternalSkill[] => {
	return INTERNAL_SKILLS;
};

export const findInternalSkill = (name: string): InternalSkill | undefined => {
	return INTERNAL_SKILLS.find((skill) => skill.name === name.trim().toLowerCase());
};

export const internalSkillNames = (): string[] => {
	return INTERNAL_SKILLS.map((skill) => skill.name);
};
