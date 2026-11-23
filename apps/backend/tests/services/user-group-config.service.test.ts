import { describe, expect, it } from 'vitest';

import { parseUserGroupsConfig, UserGroupConfigError } from '../../src/services/user-group-config.service';

const CONFIG = `
groups:
    - id: default
      capabilities:
          show_all_settings: true
          tool_call_density:
              default_density: compact
              can_change: false
      access:
          files:
              mode: restricted
              grants:
                  - kind: folder
                    path: docs
    - id: all_users
    - id: finance
      name: Finance team
      list_of_emails: [BOB@example.com, alice@example.com, bob@example.com]
      sso_groups:
          oidc: [finance-team]
      capabilities:
          features: [story_creation]
          tool_call_density:
              default_density: detailed
      access:
          databases:
              mode: restricted
              grants:
                  - kind: schema
                    database_type: postgres
                    database: warehouse
                    schema: finance
          files:
              mode: restricted
              grants:
                  - kind: folder
                    path: docs/finance
                  - kind: file
                    path: semantics/revenue.yaml
      policies:
          rows:
              - database_type: postgres
                database: warehouse
                schema: finance
                table: invoices
                access: predicate
                mode: guided
                conditions:
                    - column: region
                      operator: is_one_of
                      values: [emea, apac]
`;

describe('parseUserGroupsConfig', () => {
	it('inherits leaves from default, splits docs out of files, and hashes the result', () => {
		const parsed = parseUserGroupsConfig(CONFIG);

		expect(parsed.allUsers).toMatchObject({
			showAllSettings: true,
			toolCallDensityPolicy: { defaultDensity: 'compact', canChange: false },
			docsAccess: { mode: 'all' },
			filesAccess: { mode: 'restricted', grants: [] },
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
		});
		expect(parsed.groups).toHaveLength(1);
		expect(parsed.groups[0]).toMatchObject({
			key: 'finance',
			name: 'Finance team',
			members: ['alice@example.com', 'bob@example.com'],
			ssoMappings: { providers: { oidc: ['finance-team'] } },
			features: ['storyCreation'],
			showAllSettings: true,
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			filesAccess: { mode: 'restricted', grants: [{ kind: 'file', path: 'semantics/revenue.yaml' }] },
			rowPolicies: {
				policies: [{ table: 'invoices', conditions: [{ operator: 'is-one-of', value: 'emea,apac' }] }],
			},
		});
		expect(parsed.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(parseUserGroupsConfig(CONFIG.replace('BOB@example.com', 'bob@example.com')).hash).toBe(parsed.hash);
	});

	it.each([
		['a leftover version key', ['groups:', 'version: 1\ngroups:'], 'version'],
		['a missing all_users group', ['    - id: all_users\n', ''], 'The "all_users" group is required.'],
		['a duplicate id', ['    - id: all_users\n', '    - id: all_users\n    - id: finance\n'], 'Duplicate group id'],
		[
			'a name on a reserved group',
			['    - id: all_users\n', '    - id: all_users\n      name: Everyone\n'],
			'cannot declare',
		],
		[
			'a name already in use',
			['name: Finance team', 'name: All Users'],
			'name "All Users" is already used by "all_users"',
		],
		['a non-snake_case id', ['id: finance', 'id: Finance'], '"Finance": id: Group ids must be snake_case'],
		[
			'a share target to an unknown group',
			['features: [story_creation]', 'share_targets: {group_ids: [missing]}'],
			'unknown group "missing"',
		],
		[
			'a protected tables section',
			['groups:', 'protected_tables:\n    rows: []\ngroups:'],
			'Protected tables are not managed by groups.yaml yet',
		],
		[
			'a column policy',
			['          rows:', '          columns: [{table: t}]\n          rows:'],
			'not supported yet',
		],
		['a comma in a list value', ['values: [emea, apac]', 'values: ["emea,apac"]'], 'cannot contain commas'],
	])('rejects %s', (_label, [search, replacement], message) => {
		const source = CONFIG.replace(search, replacement);

		expect(source).not.toBe(CONFIG);
		expect(() => parseUserGroupsConfig(source)).toThrow(UserGroupConfigError);
		expect(() => parseUserGroupsConfig(source)).toThrow(message);
	});
});
