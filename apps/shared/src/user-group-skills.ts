export type SkillsAccess = { mode: 'all' } | { mode: 'restricted'; skills: string[] };

export const ALL_SKILLS_ACCESS: SkillsAccess = { mode: 'all' };
export const EMPTY_SKILLS_ACCESS: SkillsAccess = { mode: 'restricted', skills: [] };

const MAX_SKILL_NAME_LENGTH = 200;
const MAX_SKILL_GRANTS = 10_000;

export function normalizeSkillsAccess(access: SkillsAccess): SkillsAccess {
	if (access.mode === 'all') {
		return ALL_SKILLS_ACCESS;
	}
	const skills = access.skills.map(normalizeSkillName).filter((skill): skill is string => skill !== null);
	return { mode: 'restricted', skills: [...new Set(skills)].sort((left, right) => left.localeCompare(right)) };
}

export function parseSkillsAccess(value: unknown): SkillsAccess {
	if (!isRecord(value)) {
		return EMPTY_SKILLS_ACCESS;
	}
	if (value.mode === 'all') {
		return hasOnlyKeys(value, ['mode']) ? ALL_SKILLS_ACCESS : EMPTY_SKILLS_ACCESS;
	}
	if (
		value.mode !== 'restricted' ||
		!hasOnlyKeys(value, ['mode', 'skills']) ||
		!Array.isArray(value.skills) ||
		value.skills.length > MAX_SKILL_GRANTS ||
		value.skills.some((skill) => typeof skill !== 'string' || normalizeSkillName(skill) === null)
	) {
		return EMPTY_SKILLS_ACCESS;
	}
	return normalizeSkillsAccess({ mode: 'restricted', skills: value.skills as string[] });
}

export function unionSkillsAccess(accesses: readonly SkillsAccess[]): SkillsAccess {
	if (accesses.some((access) => access.mode === 'all')) {
		return ALL_SKILLS_ACCESS;
	}
	return normalizeSkillsAccess({
		mode: 'restricted',
		skills: accesses.flatMap((access) => (access.mode === 'restricted' ? access.skills : [])),
	});
}

export function isSkillGranted(access: SkillsAccess, skillName: string): boolean {
	return access.mode === 'all' || access.skills.includes(skillName.trim());
}

function normalizeSkillName(value: string): string | null {
	const normalized = value.trim();
	return normalized && normalized.length <= MAX_SKILL_NAME_LENGTH ? normalized : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowedKeys = new Set(keys);
	return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
