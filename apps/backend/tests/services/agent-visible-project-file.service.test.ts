import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { describe, expect, it, vi } from 'vitest';

import { renderProjectTextForAgent } from '../../src/services/agent-visible-project-file.service';
import { useTemporaryFolders } from '../helpers/temporary-folders';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const SYNCED_RULES_FILE = 'repos/business_context/nao/RULES.md';
const GATED_RULES = ['Public', '{% if group("finance") %}', 'Margins are confidential.', '{% endif %}'].join('\n');

describe('renderProjectTextForAgent', () => {
	const createTemporaryFolder = useTemporaryFolders();

	it.each(['/RULES.md', `/${SYNCED_RULES_FILE}`])('renders the group blocks of the rules file %s', (virtualPath) => {
		const projectFolder = createTemporaryFolder('nao-agent-visible-');
		mkdirSync(dirname(join(projectFolder, SYNCED_RULES_FILE)), { recursive: true });
		writeFileSync(join(projectFolder, SYNCED_RULES_FILE), GATED_RULES);
		writeFileSync(join(projectFolder, 'nao_config.yaml'), `project_name: acme\nrules_file: ${SYNCED_RULES_FILE}\n`);
		const context = {
			projectFolder,
			userRulesGroupAccess: { enforced: true, groupNames: ['sales'] },
			warehouseColumnSecurity: { enforced: false },
		} as const;

		expect(renderProjectTextForAgent(virtualPath, GATED_RULES, context)).toBe('Public\n');
		expect(renderProjectTextForAgent('/docs/guide.md', GATED_RULES, context)).toBe(GATED_RULES);
	});
});
