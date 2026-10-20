import { describe, expect, it } from 'vitest';

import {
	canRoleSeeAdvancedSettings,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	DEFAULT_USER_GROUP_CONFIG,
	parseStoredUserGroupConfig,
	serializeUserGroupConfig,
	USER_GROUP_FEATURES,
} from './user-group-features';

describe('user group configuration', () => {
	it('uses canonical v2 configuration for new groups', () => {
		expect(DEFAULT_USER_GROUP_CONFIG).toEqual({
			version: 2,
			features: [],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
	});

	it('serializes canonical v2 configuration without compact-mode', () => {
		expect(
			serializeUserGroupConfig(
				['storyCreation', 'automationCreation', 'compact-mode'],
				{
					defaultDensity: 'compact',
					canChange: false,
				},
				true,
			),
		).toEqual({
			version: 2,
			features: ['storyCreation', 'automationCreation'],
			toolCallDensity: {
				defaultDensity: 'compact',
				canChange: false,
			},
			showAllSettings: true,
		});
		expect(USER_GROUP_FEATURES).toEqual(['storyCreation', 'customStoryCreation', 'automationCreation']);
	});

	it('reads canonical v2 configuration', () => {
		expect(
			parseStoredUserGroupConfig({
				version: 2,
				features: ['storyCreation', 'automationCreation'],
				toolCallDensity: {
					defaultDensity: 'compact',
					canChange: true,
				},
				showAllSettings: true,
			}),
		).toEqual({
			features: ['storyCreation', 'automationCreation'],
			toolCallDensity: {
				defaultDensity: 'compact',
				canChange: true,
			},
			showAllSettings: true,
		});
	});

	it('shows all settings to All Users and hides them for custom groups until configured', () => {
		const storedBeforeSettingExisted = {
			version: 2,
			features: [],
			toolCallDensity: DEFAULT_TOOL_CALL_DENSITY_POLICY,
		};

		expect(parseStoredUserGroupConfig(storedBeforeSettingExisted, true).showAllSettings).toBe(true);
		expect(parseStoredUserGroupConfig(storedBeforeSettingExisted, false).showAllSettings).toBe(false);
		expect(parseStoredUserGroupConfig(['story-creation'], true).showAllSettings).toBe(true);
	});

	it('keeps the saved settings visibility over the group default', () => {
		const hidden = {
			version: 2,
			features: [],
			toolCallDensity: DEFAULT_TOOL_CALL_DENSITY_POLICY,
			showAllSettings: false,
		};
		const shown = {
			version: 2,
			features: [],
			toolCallDensity: DEFAULT_TOOL_CALL_DENSITY_POLICY,
			showAllSettings: true,
		};

		expect(parseStoredUserGroupConfig(hidden, true).showAllSettings).toBe(false);
		expect(parseStoredUserGroupConfig(shown, false).showAllSettings).toBe(true);
	});

	it('maps legacy compact-mode to an unlocked detailed policy', () => {
		expect(parseStoredUserGroupConfig(['story-creation', 'compact-mode'])).toEqual({
			features: ['storyCreation'],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: true,
			},
			showAllSettings: false,
		});
	});

	it('maps legacy configuration without compact-mode to a locked detailed policy', () => {
		expect(parseStoredUserGroupConfig(['story-creation'])).toEqual({
			features: ['storyCreation'],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: false,
			},
			showAllSettings: false,
		});
	});

	it.each([
		['stories', 'storyCreation'],
		['story-creation', 'storyCreation'],
		['automations', 'automationCreation'],
		['automation-creation', 'automationCreation'],
	])('normalizes the legacy %s alias', (alias, feature) => {
		expect(parseStoredUserGroupConfig([alias])).toEqual({
			features: [feature],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: false,
			},
			showAllSettings: false,
		});
	});

	it('removes unknown legacy features', () => {
		expect(parseStoredUserGroupConfig(['unknown'])).toEqual({
			features: [],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: false,
			},
			showAllSettings: false,
		});
	});
});

describe('canRoleSeeAdvancedSettings', () => {
	it('follows the groups only for the User role', () => {
		expect(canRoleSeeAdvancedSettings('user', true)).toBe(true);
		expect(canRoleSeeAdvancedSettings('user', false)).toBe(false);
	});

	it('always shows advanced settings to admins and context admins', () => {
		expect(canRoleSeeAdvancedSettings('admin', false)).toBe(true);
		expect(canRoleSeeAdvancedSettings('context_admin', false)).toBe(true);
	});

	it('never shows advanced settings to viewers or users without a role', () => {
		expect(canRoleSeeAdvancedSettings('viewer', true)).toBe(false);
		expect(canRoleSeeAdvancedSettings(null, true)).toBe(false);
		expect(canRoleSeeAdvancedSettings(undefined, true)).toBe(false);
	});
});
