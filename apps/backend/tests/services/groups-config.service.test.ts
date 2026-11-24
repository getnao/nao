import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { GroupsConfigError, parseGroupsConfig } from '../../src/services/groups-config.service';

describe('groups config', () => {
	it('parses the documented complete example', () => {
		const documentation = fs.readFileSync(
			path.resolve(import.meta.dirname, '../../../../.cursor/docs/GROUPS_AS_CODE.md'),
			'utf8',
		);
		const source = /## Appendix:[\s\S]*?```yaml\n([\s\S]*?)```/.exec(documentation)?.[1];

		expect(source).toBeDefined();
		expect(parseGroupsConfig(source!)).toMatchObject({
			groups: [
				{ configId: 'finance', name: 'Finance' },
				{ configId: 'leadership', name: 'Leadership' },
			],
		});
	});

	it.each([
		['requires all_users', 'groups: []', 'The "all_users" group is required.'],
		[
			'rejects names on reserved groups',
			'groups:\n  - id: all_users\n    name: Everyone\n',
			'"all_users" cannot declare name',
		],
		[
			'rejects duplicate ids',
			'groups:\n  - id: all_users\n  - id: finance\n  - id: finance\n',
			'Duplicate group id "finance".',
		],
		[
			'rejects duplicate names',
			'groups:\n  - id: all_users\n  - id: finance\n    name: Team\n  - id: sales\n    name: Team\n',
			'name "Team" is already used',
		],
		[
			'rejects protected_tables',
			'groups:\n  - id: all_users\nprotected_tables: {}\n',
			'Protected tables are not managed by groups.yaml',
		],
	])('%s', (_label, source, message) => {
		expect(() => parseGroupsConfig(source)).toThrowError(new RegExp(message.replaceAll('.', '\\.')));
	});

	it('replaces inherited leaves instead of merging their lists', () => {
		const config = parseGroupsConfig(`
groups:
    - id: default
      capabilities:
          features: [story_creation]
          skills:
              mode: restricted
              allowed: [shared]
              preloaded: []
    - id: all_users
      capabilities:
          features: [automation_creation]
    - id: finance
`);

		expect(config.allUsers.features).toEqual(['automationCreation']);
		expect(config.allUsers.skillsAccess).toEqual({ mode: 'restricted', skills: ['shared'] });
		expect(config.groups[0].features).toEqual(['storyCreation']);
	});

	it('reports configuration failures with the dedicated error type', () => {
		expect(() => parseGroupsConfig('groups: nope')).toThrow(GroupsConfigError);
	});
});
