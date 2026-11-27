import { isMap, isSeq, type Pair, parseDocument, type Scalar, type YAMLMap } from 'yaml';

import { parseGroupsConfig } from './groups-config.service';

const KEY_ORDER = [
	'groups',
	'protected_tables',
	'budget',
	'id',
	'name',
	'list_of_emails',
	'sso_groups',
	'oidc',
	'microsoft',
	'default_project_role',
	'capabilities',
	'features',
	'tool_call_density',
	'default_density',
	'can_change',
	'show_all_settings',
	'advanced_context_explorer',
	'project_sharing',
	'share_targets',
	'include_own_group',
	'group_ids',
	'mcp',
	'skills',
	'mode',
	'grants',
	'allowed',
	'preloaded',
	'access',
	'databases',
	'files',
	'strict',
	'patterns',
	'kind',
	'database_type',
	'database',
	'schema',
	'table',
	'server',
	'tool',
	'path',
	'policies',
	'rows',
	'columns',
	'granted_columns',
	'combinator',
	'conditions',
	'column',
	'operator',
	'value',
	'values',
] as const;
const KEY_RANK = new Map(KEY_ORDER.map((key, index) => [key, index]));

export function formatGroupsConfig(source: string): string {
	parseGroupsConfig(source);
	const document = parseDocument(source);
	if (document.errors.length > 0) {
		throw document.errors[0];
	}
	sortNode(document.contents);
	return document.toString({ indent: 4, lineWidth: 0 });
}

function sortNode(node: unknown): void {
	if (isMap(node)) {
		sortMap(node);
		for (const pair of node.items) {
			sortNode(pair.value);
		}
		return;
	}
	if (isSeq(node)) {
		for (const item of node.items) {
			sortNode(item);
		}
	}
}

function sortMap(map: YAMLMap): void {
	map.items.sort((left, right) => keyRank(left) - keyRank(right));
}

function keyRank(pair: Pair): number {
	const key = (pair.key as Scalar | null)?.value;
	return typeof key === 'string'
		? (KEY_RANK.get(key as (typeof KEY_ORDER)[number]) ?? KEY_ORDER.length)
		: KEY_ORDER.length;
}
