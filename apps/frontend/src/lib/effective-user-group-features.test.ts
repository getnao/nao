import { describe, expect, it } from 'vitest';

import { getEffectiveToolCallDensity, getRenderableUserGroupAccess } from './effective-user-group-features';

const effectiveAccess = {
	features: {
		'story-creation': true,
		'automation-creation': false,
	},
	toolCallDensityPolicy: {
		defaultDensity: 'compact' as const,
		canChange: true,
	},
};

describe('getRenderableUserGroupAccess', () => {
	it('returns effective access only when it is available', () => {
		expect(getRenderableUserGroupAccess(effectiveAccess, true)).toEqual(effectiveAccess);
	});

	it('denies features and locks density while loading or after an error', () => {
		expect(getRenderableUserGroupAccess(effectiveAccess, false)).toEqual({
			features: {
				'story-creation': false,
				'automation-creation': false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: false,
			},
		});
	});

	it('uses loading-safe access when no project result exists', () => {
		expect(getRenderableUserGroupAccess(undefined, true)).toEqual({
			features: {
				'story-creation': false,
				'automation-creation': false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: false,
			},
		});
	});
});

describe('getEffectiveToolCallDensity', () => {
	it('uses a stored preference while unlocked', () => {
		expect(
			getEffectiveToolCallDensity('detailed', {
				defaultDensity: 'compact',
				canChange: true,
			}),
		).toBe('detailed');
	});

	it('uses the group default while unlocked without a stored preference', () => {
		expect(
			getEffectiveToolCallDensity(undefined, {
				defaultDensity: 'compact',
				canChange: true,
			}),
		).toBe('compact');
	});

	it('forces the group default while locked and restores the stored preference when unlocked', () => {
		const storedDensity = 'compact';
		expect(
			getEffectiveToolCallDensity(storedDensity, {
				defaultDensity: 'detailed',
				canChange: false,
			}),
		).toBe('detailed');
		expect(
			getEffectiveToolCallDensity(storedDensity, {
				defaultDensity: 'detailed',
				canChange: true,
			}),
		).toBe('compact');
	});
});
