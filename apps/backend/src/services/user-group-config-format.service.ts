import { type Document, isMap, isScalar, isSeq, type Pair, parseDocument, visit, type YAMLMap } from 'yaml';

import { DOCS_ROOT, toSnakeCase, UserGroupConfigError } from './user-group-config.service';
import { groupIdFromName } from './user-group-config-export.service';

interface MapContext {
	order: string[];
	children?: Record<string, string>;
	renames?: Record<string, string>;
	snakeCaseValues?: string[];
}

const TABLE_KEYS = ['database_type', 'database', 'schema', 'table'];

/** `protected_tables` and `budget` are reserved for their own files, so they are left exactly as written. */
const CONTEXTS: Record<string, MapContext> = {
	root: { order: ['groups', 'protected_tables', 'budget'], children: { groups: 'group' } },
	group: {
		order: ['id', 'name', 'list_of_emails', 'sso_groups', 'capabilities', 'access', 'policies'],
		children: { sso_groups: 'ssoGroups', capabilities: 'capabilities', access: 'access', policies: 'policies' },
		renames: { key: 'id', members: 'list_of_emails' },
	},
	ssoGroups: { order: ['oidc', 'microsoft', 'default_project_role'] },
	capabilities: {
		order: [
			'features',
			'tool_call_density',
			'show_all_settings',
			'advanced_context_explorer',
			'project_sharing',
			'share_targets',
			'mcp',
			'skills',
		],
		children: { tool_call_density: 'toolCallDensity', share_targets: 'shareTargets', mcp: 'mcp', skills: 'skills' },
		snakeCaseValues: ['features'],
	},
	toolCallDensity: { order: ['default_density', 'can_change'] },
	shareTargets: { order: ['include_own_group', 'group_ids'] },
	mcp: { order: ['mode', 'grants'], children: { grants: 'mcpGrant' } },
	mcpGrant: { order: ['kind', 'server', 'tool'] },
	skills: { order: ['mode', 'allowed', 'preloaded'] },
	access: { order: ['databases', 'files'], children: { databases: 'databases', files: 'files' } },
	databases: { order: ['mode', 'strict', 'grants', 'patterns'], children: { grants: 'databaseGrant' } },
	databaseGrant: { order: ['kind', ...TABLE_KEYS] },
	files: { order: ['mode', 'grants'], children: { grants: 'fileGrant' } },
	fileGrant: { order: ['kind', 'path'] },
	policies: { order: ['rows', 'columns'], children: { rows: 'rowPolicy', columns: 'columnPolicy' } },
	rowPolicy: {
		order: [...TABLE_KEYS, 'access', 'mode', 'combinator', 'conditions', 'predicate'],
		children: { conditions: 'condition' },
	},
	condition: { order: ['column', 'operator', 'value', 'values'], snakeCaseValues: ['operator'] },
	columnPolicy: { order: [...TABLE_KEYS, 'granted_columns'] },
};

/** Rewrites `groups.yaml` with the standard key order and indentation, keeping comments, and fixes mechanical mistakes. */
export function formatUserGroupsConfig(source: string): string {
	const document = parseDocument(source);
	if (document.errors.length > 0) {
		throw new UserGroupConfigError(document.errors.map((error) => error.message).join('\n'));
	}
	visit(document, { Pair: (_key, pair) => keepInlineKeyComment(pair, source) });
	if (isMap(document.contents)) {
		removeVersion(document.contents);
		formatMap(document, document.contents, 'root');
	}
	return document.toString({ indent: 4, indentSeq: true, lineWidth: 0, flowCollectionPadding: false });
}

function formatMap(document: Document, map: YAMLMap, contextName: string): void {
	const context = CONTEXTS[contextName]!;
	for (const pair of map.items) {
		if (isScalar(pair.key) && typeof pair.key.value === 'string') {
			const key = toSnakeCase(pair.key.value);
			const renamed = context.renames?.[key] ?? key;
			pair.key.value = map.has(renamed) && renamed !== pair.key.value ? key : renamed;
		}
	}
	if (contextName === 'group') {
		fixGroupName(map);
		moveDocsAccess(document, map);
	}
	for (const key of context.snakeCaseValues ?? []) {
		snakeCaseValues(map.get(key, true));
	}
	for (const [key, childContext] of Object.entries(context.children ?? {})) {
		const child = map.get(key, true);
		for (const node of isSeq(child) ? child.items : [child]) {
			if (isMap(node)) {
				formatMap(document, node, childContext);
			}
		}
	}
	const rank = (key: unknown) => {
		const index = context.order.indexOf(String(isScalar(key) ? key.value : key));
		return index === -1 ? context.order.length : index;
	};
	map.items.sort((left, right) => rank(left.key) - rank(right.key));
}

/** `yaml` attaches `key: # note` to the nested block below and would print it on its own line. */
function keepInlineKeyComment(pair: Pair<unknown, unknown>, source: string): void {
	const { key, value } = pair;
	if (!isScalar(key) || !key.range || !(isMap(value) || isSeq(value)) || !value.commentBefore) {
		return;
	}
	const afterKey = source.slice(key.range[1], value.range?.[0]);
	const commentStart = afterKey.indexOf('#');
	if (commentStart !== -1 && !afterKey.slice(0, commentStart).includes('\n')) {
		key.comment = value.commentBefore;
		value.commentBefore = undefined;
	}
}

/** `version` is no longer part of the file, so it is dropped and its comment moves to the next key. */
function removeVersion(root: YAMLMap): void {
	const index = root.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === 'version');
	if (index === -1) {
		return;
	}
	const [removed] = root.items.splice(index, 1);
	const comment = isScalar(removed!.key) ? removed!.key.commentBefore : undefined;
	const next = root.items[index]?.key;
	if (comment && isScalar(next)) {
		next.commentBefore = next.commentBefore ? `${comment}\n${next.commentBefore}` : comment;
	}
}

/** A group written with only a display `name` gets an id derived from it. */
function fixGroupName(group: YAMLMap): void {
	const name = group.get('name');
	if (typeof name === 'string' && !group.has('id')) {
		group.set('id', groupIdFromName(name));
	}
}

/** Docs access is now part of `access.files`, with paths relative to the project root. */
function moveDocsAccess(document: Document, group: YAMLMap): void {
	const access = group.get('access', true);
	const owner = group.has('docs_access') ? group : isMap(access) && access.has('docs_access') ? access : null;
	const docsAccess = owner?.get('docs_access', true);
	if (!owner || !isMap(docsAccess)) {
		return;
	}
	owner.delete('docs_access');
	const docsGrants =
		docsAccess.get('mode') === 'all'
			? [{ kind: 'folder', path: DOCS_ROOT }]
			: (docsAccess.toJSON().grants ?? []).map((grant: { kind: string; path: string }) => ({
					kind: grant.kind,
					path: `${DOCS_ROOT}/${grant.path}`,
				}));
	if (!isMap(access)) {
		group.set('access', document.createNode({ files: { mode: 'restricted', grants: docsGrants } }));
		return;
	}
	const files = access.get('files', true);
	if (!isMap(files)) {
		access.set('files', document.createNode({ mode: 'restricted', grants: docsGrants }));
		return;
	}
	if (files.get('mode') === 'all') {
		return;
	}
	const grants = files.get('grants', true);
	if (isSeq(grants)) {
		grants.items.push(...docsGrants.map((grant: object) => document.createNode(grant)));
	} else {
		files.set('grants', document.createNode(docsGrants));
	}
}

function snakeCaseValues(node: unknown): void {
	for (const item of isSeq(node) ? node.items : [node]) {
		if (isScalar(item) && typeof item.value === 'string') {
			item.value = toSnakeCase(item.value);
		}
	}
}
