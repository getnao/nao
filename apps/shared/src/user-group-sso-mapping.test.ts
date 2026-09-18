import { describe, expect, it } from 'vitest';

import {
	EMPTY_USER_GROUP_SSO_MAPPINGS,
	isMicrosoftEntraGroupId,
	normalizeSsoGroupIdentifiers,
	parseStoredUserGroupSsoMappings,
	serializeUserGroupSsoMappings,
} from './user-group-sso-mapping';

describe('User Group SSO mappings', () => {
	it('normalizes and deduplicates provider identifiers', () => {
		expect(
			serializeUserGroupSsoMappings({
				version: 1,
				providers: {
					oidc: [' Finance ', 'finance', 'DATA'],
					microsoft: [' A0B1 ', 'a0b1'],
				},
			}),
		).toEqual({
			version: 1,
			providers: {
				oidc: ['finance', 'data'],
				microsoft: ['a0b1'],
			},
		});
	});

	it('safely handles missing, malformed, JSON, and legacy provider objects', () => {
		expect(parseStoredUserGroupSsoMappings(null)).toEqual(EMPTY_USER_GROUP_SSO_MAPPINGS);
		expect(parseStoredUserGroupSsoMappings('{bad json')).toEqual(EMPTY_USER_GROUP_SSO_MAPPINGS);
		expect(parseStoredUserGroupSsoMappings('{"providers":{"oidc":["Team"]}}')).toEqual({
			version: 1,
			providers: { oidc: ['team'], microsoft: [] },
		});
		expect(parseStoredUserGroupSsoMappings({ oidc: ['Legacy'] })).toEqual({
			version: 1,
			providers: { oidc: ['legacy'], microsoft: [] },
		});
	});

	it('keeps identifiers provider-specific', () => {
		expect(normalizeSsoGroupIdentifiers('oidc', ['Team A', 1, '', ' TEAM A '])).toEqual(['team a']);
		expect(normalizeSsoGroupIdentifiers('microsoft', ['ABC-123'])).toEqual(['abc-123']);
		expect(isMicrosoftEntraGroupId('A0B1C2D3-E4F5-6789-ABCD-EF0123456789')).toBe(true);
		expect(isMicrosoftEntraGroupId('not-a-guid')).toBe(false);
	});
});
