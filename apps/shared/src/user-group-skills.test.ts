import { describe, expect, it } from 'vitest';

import {
	ALL_SKILLS_ACCESS,
	EMPTY_SKILLS_ACCESS,
	isSkillGranted,
	normalizeSkillsAccess,
	parseSkillsAccess,
	unionSkillsAccess,
} from './user-group-skills';

describe('user group skills access', () => {
	it('trims, deduplicates, and sorts granted skills', () => {
		expect(normalizeSkillsAccess({ mode: 'restricted', skills: [' revenue ', 'churn', 'revenue', '  '] })).toEqual({
			mode: 'restricted',
			skills: ['churn', 'revenue'],
		});
	});

	it('parses stored grants and fails closed on anything malformed', () => {
		expect(parseSkillsAccess({ mode: 'all' })).toEqual(ALL_SKILLS_ACCESS);
		expect(parseSkillsAccess({ mode: 'all', skills: [] })).toEqual(EMPTY_SKILLS_ACCESS);
		expect(parseSkillsAccess(undefined)).toEqual(EMPTY_SKILLS_ACCESS);
		expect(parseSkillsAccess({ mode: 'restricted', skills: ['revenue', 42] })).toEqual(EMPTY_SKILLS_ACCESS);
		expect(parseSkillsAccess({ mode: 'restricted', skills: ['  '] })).toEqual(EMPTY_SKILLS_ACCESS);
		expect(parseSkillsAccess({ mode: 'restricted', skills: ['revenue'], extra: true })).toEqual(
			EMPTY_SKILLS_ACCESS,
		);
		expect(parseSkillsAccess({ mode: 'restricted', skills: ['revenue'] })).toEqual({
			mode: 'restricted',
			skills: ['revenue'],
		});
	});

	it('unions grants with all dominance', () => {
		expect(
			unionSkillsAccess([
				{ mode: 'restricted', skills: ['revenue'] },
				{ mode: 'restricted', skills: ['churn', 'revenue'] },
			]),
		).toEqual({ mode: 'restricted', skills: ['churn', 'revenue'] });
		expect(unionSkillsAccess([EMPTY_SKILLS_ACCESS, ALL_SKILLS_ACCESS])).toEqual(ALL_SKILLS_ACCESS);
		expect(unionSkillsAccess([])).toEqual(EMPTY_SKILLS_ACCESS);
	});

	it('grants only the listed skills unless access is all', () => {
		const access = { mode: 'restricted' as const, skills: ['revenue'] };
		expect(isSkillGranted(access, 'revenue')).toBe(true);
		expect(isSkillGranted(access, 'churn')).toBe(false);
		expect(isSkillGranted(ALL_SKILLS_ACCESS, 'churn')).toBe(true);
	});
});
