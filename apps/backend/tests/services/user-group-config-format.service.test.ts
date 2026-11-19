import { describe, expect, it } from 'vitest';

import { parseUserGroupsConfig } from '../../src/services/user-group-config.service';
import { formatUserGroupsConfig } from '../../src/services/user-group-config-format.service';

const UNFORMATTED = `# analytics groups
version: 1
groups:
  - id: all_users
    capabilities: # shared by everyone
      shareTargets: {groupIds: [finance_team], includeOwnGroup: true}
      features: [storyCreation]
  - name: Finance Team
    members: [a@example.com]   # finance leads
    docsAccess:
      mode: restricted
      grants:
        - {kind: folder, path: finance}
`;

const FORMATTED = `# analytics groups
groups:
    - id: all_users
      capabilities: # shared by everyone
          features: [story_creation]
          share_targets: {include_own_group: true, group_ids: [finance_team]}
    - id: finance_team
      name: Finance Team
      list_of_emails: [a@example.com] # finance leads
      access:
          files:
              mode: restricted
              grants:
                  - kind: folder
                    path: docs/finance
`;

describe('formatUserGroupsConfig', () => {
	it('fixes legacy keys, values and docs access, keeps comments, and is idempotent', () => {
		const formatted = formatUserGroupsConfig(UNFORMATTED);

		expect(formatted).toBe(FORMATTED);
		expect(formatUserGroupsConfig(formatted)).toBe(formatted);
		expect(parseUserGroupsConfig(formatted).groups[0]).toMatchObject({
			key: 'finance_team',
			name: 'Finance Team',
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
		});
	});
});
