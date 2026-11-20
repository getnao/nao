import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/queries/user.queries', () => ({ getUser: vi.fn() }));

import { getUser } from '../../src/queries/user.queries';
import {
	buildRunSqlQueryTag,
	resolveSqlQueryTagConfig,
	serializeRunSqlQueryTag,
} from '../../src/services/sql-query-tag.service';
import type { AgentSettings } from '../../src/types/agent-settings';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();

const SETTINGS_TAG = { enabled: true, template: 'from settings {{ source }}', position: 'end' } as const;
const SINGLE_DATABASE = 'databases:\n  - name: warehouse\n    type: duckdb\n';
const TWO_DATABASES = `${SINGLE_DATABASE}  - name: lake\n    type: duckdb\n`;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getUser).mockResolvedValue({ email: 'ada@example.com' } as Awaited<ReturnType<typeof getUser>>);
});

describe('resolveSqlQueryTagConfig', () => {
	it.each([
		{
			name: 'nao_config.yaml wins over the admin settings',
			yaml: 'query_tag:\n  template: "from yaml {{ user_id }}"\n',
			settings: SETTINGS_TAG,
			expected: { template: 'from yaml {{ user_id }}', position: 'start' },
		},
		{
			name: 'the admin settings apply when nao_config.yaml declares no tag',
			yaml: '',
			settings: SETTINGS_TAG,
			expected: { template: 'from settings {{ source }}', position: 'end' },
		},
		{
			name: 'an invalid tag in nao_config.yaml is ignored',
			yaml: 'query_tag:\n  template: "from yaml"\n  position: middle\n',
			settings: SETTINGS_TAG,
			expected: { template: 'from settings {{ source }}', position: 'end' },
		},
		{
			name: 'a tag turned off in the admin settings tags nothing',
			yaml: '',
			settings: { ...SETTINGS_TAG, enabled: false },
			expected: null,
		},
		{ name: 'a project without any tag tags nothing', yaml: '', settings: undefined, expected: null },
	])('$name', ({ yaml, settings, expected }) => {
		const agentSettings: AgentSettings = { sql: { queryTag: settings } };

		expect(resolveSqlQueryTagConfig(createProject(yaml), agentSettings)).toEqual(expected);
	});
});

describe('buildRunSqlQueryTag', () => {
	const template =
		'{{ user_id }}|{{ user_email }}|{{ user_groups }}|{{ project_id }}|{{ chat_id }}|{{ source }}|{{ database_id }}';

	it.each([
		{
			name: 'a chat query on the only database of the project',
			databases: SINGLE_DATABASE,
			chatId: 'chat-1',
			databaseId: undefined,
			expected: 'user-1|ada@example.com|finance,sales|project-1|chat-1|slack|warehouse',
		},
		{
			name: 'a query naming its database, outside of a chat',
			databases: TWO_DATABASES,
			chatId: null,
			databaseId: 'lake',
			expected: 'user-1|ada@example.com|finance,sales|project-1||slack|lake',
		},
		{
			name: 'a query naming no database among several',
			databases: TWO_DATABASES,
			chatId: 'chat-1',
			databaseId: undefined,
			expected: 'user-1|ada@example.com|finance,sales|project-1|chat-1|slack|',
		},
	])('tags $name', async ({ databases, chatId, databaseId, expected }) => {
		const tag = await buildRunSqlQueryTag({
			projectFolder: createProject(databases),
			agentSettings: { sql: { queryTag: { enabled: true, template, position: 'end' } } },
			projectId: 'project-1',
			userId: 'user-1',
			chatId,
			source: 'slack',
			groupAccess: { enforced: true, groupNames: ['finance', 'sales'] },
		});

		expect(tag && serializeRunSqlQueryTag(tag, databaseId)).toEqual({ comment: expected, position: 'end' });
	});

	it('does not look the user up when the project tags nothing', async () => {
		const tag = await buildRunSqlQueryTag({
			projectFolder: createProject(SINGLE_DATABASE),
			agentSettings: null,
			projectId: 'project-1',
			userId: 'user-1',
			source: 'web',
			groupAccess: { enforced: false },
		});

		expect(tag).toBeNull();
		expect(getUser).not.toHaveBeenCalled();
	});

	it('sends no tag when the comment renders empty', async () => {
		const tag = await buildRunSqlQueryTag({
			projectFolder: createProject(SINGLE_DATABASE),
			agentSettings: { sql: { queryTag: { enabled: true, template: '{{ chat_id }}', position: 'start' } } },
			projectId: 'project-1',
			userId: 'user-1',
			source: 'story',
			groupAccess: { enforced: false },
		});

		expect(tag && serializeRunSqlQueryTag(tag, undefined)).toBeUndefined();
	});
});

function createProject(yaml: string): string {
	const folder = createTemporaryFolder('nao-sql-query-tag-');
	fs.writeFileSync(path.join(folder, 'nao_config.yaml'), `project_name: test\n${yaml}`);
	return folder;
}
