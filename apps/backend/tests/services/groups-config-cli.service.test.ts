import { describe, expect, it } from 'vitest';

import { formatGroupsConfig } from '../../src/services/groups-config-cli.service';

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
});
