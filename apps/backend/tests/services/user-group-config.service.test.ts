import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseUserGroupsConfig, UserGroupConfigError } from '../../src/services/user-group-config.service';

const COMPLETE_CONFIG = `
version: 1
defaults:
  features: []
  tool_call_density:
    default_density: detailed
    can_change: true
  show_all_settings: false
  project_sharing: inherit
  share_targets:
    include_own_group: true
    group_keys: []
  preloaded_skills: []
  budget_limit_usd: null
  database_access:
    mode: restricted
    strict: false
    grants: []
    patterns: []
  docs_access:
    mode: restricted
    grants: []
  files_access:
    mode: restricted
    grants: []
  mcp_access:
    mode: restricted
    grants: []
  skills_access:
    mode: restricted
    skills: []
  row_policies:
    version: 1
    policies: []
all_users:
  show_all_settings: true
  database_access:
    mode: all
    strict: false
  docs_access:
    mode: all
  files_access:
    mode: all
  mcp_access:
    mode: all
  skills_access:
    mode: all
groups:
  - key: finance
    name: Finance
    members:
      - BOB@example.com
      - alice@example.com
      - bob@example.com
    features:
      - storyCreation
    database_access:
      mode: restricted
      strict: true
      grants:
        - kind: schema
          database_type: postgres
          database: warehouse
          schema: finance
      patterns: []
`;

describe('parseUserGroupsConfig', () => {
	it('strictly parses, inherits, normalizes, and hashes the complete file', () => {
		const parsed = parseUserGroupsConfig(COMPLETE_CONFIG);

		expect(parsed.allUsers.showAllSettings).toBe(true);
		expect(parsed.allUsers.databaseAccess).toEqual({ mode: 'all', strict: false });
		expect(parsed.groups).toHaveLength(1);
		expect(parsed.groups[0]).toMatchObject({
			key: 'finance',
			name: 'Finance',
			members: ['alice@example.com', 'bob@example.com'],
			features: ['storyCreation'],
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
			databaseAccess: {
				mode: 'restricted',
				strict: true,
				grants: [
					{
						kind: 'schema',
						databaseType: 'postgres',
						database: 'warehouse',
						schema: 'finance',
					},
				],
				patterns: [],
			},
		});
		expect(parsed.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(parseUserGroupsConfig(COMPLETE_CONFIG.replace('BOB@example.com', 'bob@example.com')).hash).toBe(
			parsed.hash,
		);
	});

	it('rejects unknown fields and incomplete defaults', () => {
		expect(() => parseUserGroupsConfig(COMPLETE_CONFIG.replace('version: 1', 'version: 1\nunknown: true'))).toThrow(
			UserGroupConfigError,
		);
		expect(() => parseUserGroupsConfig(COMPLETE_CONFIG.replace('  features: []\n', ''))).toThrow(
			UserGroupConfigError,
		);
	});

	it('rejects duplicate keys and unknown share targets', () => {
		expect(() =>
			parseUserGroupsConfig(
				COMPLETE_CONFIG.replace('groups:\n', 'groups:\n  - key: finance\n    name: Another\n    members: []\n'),
			),
		).toThrow('Duplicate group key');
		expect(() =>
			parseUserGroupsConfig(COMPLETE_CONFIG.replace('    group_keys: []', '    group_keys: [missing]')),
		).toThrow('unknown share target');
	});

	it('parses the complete administrator guide example', () => {
		const guide = fs.readFileSync(
			path.resolve(import.meta.dirname, '../../../../USER_GROUPS_AS_CODE_ADMIN_GUIDE.md'),
			'utf8',
		);
		const example = guide.match(/<!-- validated-example:start -->\s*```yaml\n([\s\S]*?)\n```/)?.[1];

		expect(example).toBeDefined();
		expect(parseUserGroupsConfig(example!)).toMatchObject({ version: 1 });
	});
});
