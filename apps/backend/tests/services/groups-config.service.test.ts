import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { GroupsConfigError, parseGroupsConfig } from '../../src/services/groups-config.service';

describe('groups config', () => {
	it('parses the complete example', () => {
		const source = fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/groups.yaml'), 'utf8');

		expect(parseGroupsConfig(source)).toMatchObject({
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
		[
			'rejects docs_grants outside docs',
			'groups:\n  - id: all_users\n    access:\n      files:\n        mode: all\n        docs_grants: [{ kind: folder, path: semantics }]\n',
			'docs_grants only accepts paths under docs/',
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

	it.each([
		['granted by all_users', 'shared', true],
		['granted by nobody', 'other', false],
	])('accepts a preloaded skill only when it is granted (%s)', (_label, skill, accepted) => {
		const source = `
groups:
    - id: all_users
      capabilities:
          skills: { mode: restricted, allowed: [shared] }
    - id: finance
      capabilities:
          skills: { mode: restricted, allowed: [], preloaded: [${skill}] }
`;

		if (accepted) {
			expect(parseGroupsConfig(source).groups[0].preloadedSkills).toEqual([skill]);
		} else {
			expect(() => parseGroupsConfig(source)).toThrowError(`preloaded skill "${skill}"`);
		}
	});

	it('reports configuration failures with the dedicated error type', () => {
		expect(() => parseGroupsConfig('groups: nope')).toThrow(GroupsConfigError);
	});
});
