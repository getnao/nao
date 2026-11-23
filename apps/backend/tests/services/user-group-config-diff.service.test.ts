import { describe, expect, it } from 'vitest';

import { diffUserGroupsConfigFiles } from '../../src/services/user-group-config-diff.service';

const PREVIOUS = `groups:
    - id: all_users
      capabilities:
          features: [story_creation]
    - key: finance
      members: [bob@example.com, alice@example.com]
      capabilities:
          features: [automation_creation, story_creation]
    - id: legacy
`;

describe('diffUserGroupsConfigFiles', () => {
	it('reports no changes when the files resolve to the same settings', () => {
		const current = `groups:
    - id: default
      capabilities:
          features: [story_creation, automation_creation]
    - id: all_users
      capabilities:
          features: [story_creation]
    - id: finance
      list_of_emails: [alice@example.com, bob@example.com]
    - id: legacy
      capabilities:
          features: []
`;

		expect(diffUserGroupsConfigFiles(PREVIOUS, current)).toEqual([]);
	});

	it('reports added, removed and changed groups setting by setting', () => {
		const current = `groups:
    - id: default
      capabilities:
          tool_call_density: {default_density: compact}
    - id: all_users
      capabilities:
          features: [story_creation]
    - id: finance
      list_of_emails: [alice@example.com, carol@example.com]
      capabilities:
          features: [story_creation]
    - id: marketing
`;

		expect(diffUserGroupsConfigFiles(PREVIOUS, current)).toEqual([
			{
				id: 'all_users',
				action: 'changed',
				settings: [
					{ path: 'capabilities.tool_call_density.default_density', before: 'detailed', after: 'compact' },
				],
			},
			{
				id: 'finance',
				action: 'changed',
				settings: [
					{ path: 'list_of_emails', added: ['carol@example.com'], removed: ['bob@example.com'] },
					{ path: 'capabilities.features', added: [], removed: ['automation_creation'] },
					{ path: 'capabilities.tool_call_density.default_density', before: 'detailed', after: 'compact' },
				],
			},
			{ id: 'legacy', action: 'removed', settings: [] },
			{ id: 'marketing', action: 'added', settings: [] },
		]);
	});
});
