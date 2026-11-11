import { describe, expect, it } from 'vitest';

import { countUsers, paginateUserSections } from './user-sections-pagination';

const sections = {
	projectUsers: ['project-1', 'project-2', 'project-3'],
	organizationUsers: ['organization-1', 'organization-2'],
};

describe('paginateUserSections', () => {
	it('fills the first page with project users before organisation users', () => {
		expect(paginateUserSections(sections, 0, 2)).toEqual({
			projectUsers: ['project-1', 'project-2'],
			organizationUsers: [],
		});
	});

	it('spans both sections across a page boundary', () => {
		expect(paginateUserSections(sections, 1, 2)).toEqual({
			projectUsers: ['project-3'],
			organizationUsers: ['organization-1'],
		});
	});

	it('returns only organisation users on later pages', () => {
		expect(paginateUserSections(sections, 2, 2)).toEqual({
			projectUsers: [],
			organizationUsers: ['organization-2'],
		});
	});
});

describe('countUsers', () => {
	it('counts users across both sections', () => {
		expect(countUsers(sections)).toBe(5);
	});
});
