import { dbtChartsSkill } from './dbt-charts.skill';
import { excelSkill } from './excel.skill';
import { pdfSkill } from './pdf.skill';
import type { InternalSkill, SkillAvailabilityContext } from './types';

export type { InternalSkill, SkillAvailabilityContext, SkillCapabilities } from './types';

const INTERNAL_SKILLS: InternalSkill[] = [excelSkill, pdfSkill, dbtChartsSkill];

const NO_SETTINGS: SkillAvailabilityContext = { agentSettings: null };

/** Catalogued in the system prompt so the agent knows what it can load, and when. */
export const listInternalSkills = (context: SkillAvailabilityContext = NO_SETTINGS): InternalSkill[] => {
	return INTERNAL_SKILLS.filter((skill) => skill.isAvailable?.(context) ?? true);
};

export const findInternalSkill = (
	name: string,
	context: SkillAvailabilityContext = NO_SETTINGS,
): InternalSkill | undefined => {
	return listInternalSkills(context).find((skill) => skill.name === name.trim().toLowerCase());
};

export const internalSkillNames = (context: SkillAvailabilityContext = NO_SETTINGS): string[] => {
	return listInternalSkills(context).map((skill) => skill.name);
};
