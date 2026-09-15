import { dbtChartsSkill } from './dbt-charts.skill';
import { excelSkill } from './excel.skill';
import { pdfSkill } from './pdf.skill';
import type { InternalSkill } from './types';

export type { InternalSkill, SkillCapabilities } from './types';

const INTERNAL_SKILLS: InternalSkill[] = [excelSkill, pdfSkill, dbtChartsSkill];

/** Catalogued in the system prompt so the agent knows what it can load, and when. */
export const listInternalSkills = (): InternalSkill[] => {
	return INTERNAL_SKILLS.filter((skill) => skill.isAvailable?.() ?? true);
};

export const findInternalSkill = (name: string): InternalSkill | undefined => {
	return listInternalSkills().find((skill) => skill.name === name.trim().toLowerCase());
};

export const internalSkillNames = (): string[] => {
	return listInternalSkills().map((skill) => skill.name);
};
