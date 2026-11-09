import { describe, expect, it, vi } from 'vitest';

import { getMissingSkillGrants, getSpecificSkillsAccess, toggleSkillGrant } from './user-group-skills';
import type { SkillsAccess } from '@nao/shared';

vi.mock('@/main', () => ({ trpc: {} }));

describe('user group skills toggles', () => {
	it('adds and removes skill grants', () => {
		const access: SkillsAccess = { mode: 'restricted', skills: ['revenue'] };
		const granted = toggleSkillGrant(access, 'churn', true);
		expect(granted).toEqual({ mode: 'restricted', skills: ['churn', 'revenue'] });
		expect(toggleSkillGrant(granted, 'churn', false)).toEqual(access);
	});

	it('leaves all access untouched and lists grants for skills missing from the project', () => {
		expect(toggleSkillGrant({ mode: 'all' }, 'revenue', false)).toEqual({ mode: 'all' });
		expect(
			getMissingSkillGrants({ mode: 'restricted', skills: ['removed', 'revenue'] }, [{ name: 'revenue' }]),
		).toEqual(['removed']);
		expect(getMissingSkillGrants({ mode: 'all' }, [])).toEqual([]);
	});
});

describe('user group skills specific selection', () => {
	const savedAccess: SkillsAccess = { mode: 'restricted', skills: ['revenue'] };

	it('grants the preloaded skills when licensed', () => {
		expect(getSpecificSkillsAccess({ mode: 'all' }, savedAccess, ['churn'], true)).toEqual({
			mode: 'restricted',
			skills: ['churn'],
		});
	});

	it('restores the saved access when unlicensed so Everything can be undone', () => {
		expect(getSpecificSkillsAccess({ mode: 'all' }, savedAccess, ['churn'], false)).toEqual(savedAccess);
		expect(getSpecificSkillsAccess({ mode: 'all' }, { mode: 'all' }, [], false)).toEqual({ mode: 'all' });
	});

	it('keeps an existing restricted selection', () => {
		const access: SkillsAccess = { mode: 'restricted', skills: [] };
		expect(getSpecificSkillsAccess(access, savedAccess, [], false)).toBe(access);
	});
});
