import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getUserRules } from '../../src/agents/user-rules';
import { renderProjectTextForAgent } from '../../src/services/agent-visible-project-file.service';
import { extractContextPresence } from '../../src/utils/nao-config';
import { useTemporaryFolders } from '../helpers/temporary-folders';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const SYNCED_RULES_FILE = 'repos/business_context/nao/RULES.md';
const GATED_RULES = ['Answer in French.', '{% if group("finance") %}', 'Margins are confidential.', '{% endif %}'].join(
	'\n',
);
const salesAccess = { enforced: true, groupNames: ['sales'] } as const;

describe('rules_file', () => {
	const createTemporaryFolder = useTemporaryFolders();
	let projectFolder: string;

	beforeEach(() => {
		projectFolder = createTemporaryFolder('nao-rules-file-');
		writeFileSync(join(projectFolder, 'RULES.md'), 'Root rules.\n');
	});

	it('reads the rules from the file nao_config.yaml names, such as one of a synced repository', () => {
		writeProjectFile(SYNCED_RULES_FILE, 'Analyst rules.\n');
		writeConfig(SYNCED_RULES_FILE);

		expect(getUserRules(projectFolder)).toBe('Analyst rules.\n');
		expect(extractContextPresence(projectFolder)).toMatchObject({ rules: true, rulesFile: SYNCED_RULES_FILE });
	});

	it.each([
		{ reason: 'is not synced yet', rulesFile: SYNCED_RULES_FILE },
		{ reason: 'leads outside the project', rulesFile: '../RULES.md' },
		{ reason: 'is a dotfile', rulesFile: '.env' },
	])('falls back to RULES.md when the configured file $reason', ({ rulesFile }) => {
		writeProjectFile('.env', 'SECRET=1\n');
		writeConfig(rulesFile);

		expect(getUserRules(projectFolder)).toBe('Root rules.\n');
		expect(extractContextPresence(projectFolder).rulesFile).toBe('RULES.md');
	});

	it('renders the group blocks of the configured file when the agent reads it with a tool', () => {
		writeProjectFile(SYNCED_RULES_FILE, GATED_RULES);
		writeConfig(SYNCED_RULES_FILE);
		const context = {
			projectFolder,
			userRulesGroupAccess: salesAccess,
			warehouseColumnSecurity: { enforced: false },
		} as const;

		const content = renderProjectTextForAgent(`/${SYNCED_RULES_FILE}`, GATED_RULES, context);

		expect(content).toContain('Answer in French.');
		expect(content).not.toContain('Margins are confidential.');
		expect(renderProjectTextForAgent('/RULES.md', GATED_RULES, context)).not.toContain('Margins');
	});

	function writeConfig(rulesFile: string): void {
		writeFileSync(join(projectFolder, 'nao_config.yaml'), `project_name: acme\nrules_file: ${rulesFile}\n`);
	}

	function writeProjectFile(file: string, content: string): void {
		mkdirSync(dirname(join(projectFolder, file)), { recursive: true });
		writeFileSync(join(projectFolder, file), content);
	}
});
