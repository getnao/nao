import { describe, expect, it, vi } from 'vitest';

import { getMissingSkillGrants, toggleSkillGrant } from './user-group-skills';
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
