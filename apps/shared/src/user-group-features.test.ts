import { describe, expect, it } from 'vitest';

import {
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
			serializeUserGroupConfig(['story-creation', 'automation-creation', 'compact-mode'], {
				defaultDensity: 'compact',
				canChange: false,
			}),
		).toEqual({
			version: 2,
			features: ['story-creation', 'automation-creation'],
			toolCallDensity: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
		expect(USER_GROUP_FEATURES).toEqual(['story-creation', 'automation-creation']);
	});

	it('reads canonical v2 configuration', () => {
		expect(
			parseStoredUserGroupConfig({
				version: 2,
				features: ['story-creation', 'automation-creation'],
				toolCallDensity: {
					defaultDensity: 'compact',
					canChange: true,
				},
			}),
		).toEqual({
			features: ['story-creation', 'automation-creation'],
			toolCallDensity: {
				defaultDensity: 'compact',
				canChange: true,
			},
		});
	});

	it('maps legacy compact-mode to an unlocked detailed policy', () => {
		expect(parseStoredUserGroupConfig(['story-creation', 'compact-mode'])).toEqual({
			features: ['story-creation'],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
	});

	it('maps legacy configuration without compact-mode to a locked detailed policy', () => {
		expect(parseStoredUserGroupConfig(['story-creation'])).toEqual({
			features: ['story-creation'],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: false,
			},
		});
	});

	it('normalizes legacy aliases and removes unknown features', () => {
		expect(parseStoredUserGroupConfig(['stories', 'automations', 'unknown', 'compact-mode'])).toEqual({
			features: ['story-creation', 'automation-creation'],
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
	});
});
