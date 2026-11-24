import { describe, expect, it } from 'vitest';

import { diffGroupsConfigSources, formatGroupsConfig } from '../../src/services/groups-config-cli.service';

describe('groups config CLI', () => {
	it('formats key order and indentation without dropping comments', () => {
		const formatted = formatGroupsConfig(`
groups:
  - capabilities:
      features: [] # keep this
    name: Finance
    id: finance
  - id: all_users
`);

		expect(formatted).toContain('id: finance\n      name: Finance\n      capabilities:');
		expect(formatted).toContain('# keep this');
		expect(formatGroupsConfig(formatted)).toBe(formatted);
	});

	it('does not report changes between semantically equivalent files', () => {
		const current = `
groups:
    - id: all_users
      capabilities:
          features: [story_creation]
    - id: finance
      list_of_emails: [alice@example.com]
`;
		const next = `
groups:
  - id: finance
    list_of_emails:
      - alice@example.com
  - capabilities:
      features:
        - story_creation
    id: all_users
`;

		expect(diffGroupsConfigSources(current, next)).toEqual([]);
	});
});
