import { describe, expect, it } from 'vitest';

import { canSeeAdvancedSettings, getGroupShowsAllSettings } from '@/lib/advanced-settings-access';

const allUsers = { showAllSettings: false, isDefault: true, memberIds: [] };
const analysts = { showAllSettings: true, isDefault: false, memberIds: ['analyst-id'] };

describe('canSeeAdvancedSettings', () => {
	it('keeps every settings page visible while All Users is not configured', () => {
		expect(canSeeAdvancedSettings({}, 'user', 'user-id')).toBe(true);
	});

	it('restricts users to their account when All Users hides advanced settings', () => {
		expect(canSeeAdvancedSettings({ allUsers, analysts }, 'user', 'user-id')).toBe(false);
	});

	it('grants advanced settings through any group the user belongs to', () => {
		expect(canSeeAdvancedSettings({ allUsers, analysts }, 'user', 'analyst-id')).toBe(true);
	});

	it('never restricts admins and context admins', () => {
		expect(canSeeAdvancedSettings({ allUsers }, 'admin', 'user-id')).toBe(true);
		expect(canSeeAdvancedSettings({ allUsers }, 'context_admin', 'user-id')).toBe(true);
	});
});

describe('getGroupShowsAllSettings', () => {
	it('defaults to on for All Users and off for other groups', () => {
		expect(getGroupShowsAllSettings({}, { id: 'all-users', isDefault: true })).toBe(true);
		expect(getGroupShowsAllSettings({}, { id: 'analysts', isDefault: false })).toBe(false);
	});
});
