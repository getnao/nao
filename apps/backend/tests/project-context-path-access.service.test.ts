import type { FilesContextAccess } from '@nao/shared';
import { describe, expect, it } from 'vitest';

import { isProjectContextPathAllowed } from '../src/services/project-context-path-access.service';

const unrestrictedWarehouse = { enforced: false as const };
const unenforcedDocs = { enforced: false as const };
const unenforcedFiles = { enforced: false as const };
const allMcpAccess = { mode: 'all' as const };

function filesContext(access: FilesContextAccess) {
	return {
		warehouseTableAccess: unrestrictedWarehouse,
		docsContextAccess: unenforcedDocs,
		filesContextAccess: { enforced: true as const, access },
		mcpAccess: allMcpAccess,
	};
}

describe('project context path access', () => {
	it('allows unaffected project paths and an unlicensed docs bypass', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: unenforcedDocs,
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		expect(isProjectContextPathAllowed(context, '/RULES.md', '/RULES.md', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/docs/anything.md', '/docs/anything.md', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/alias.sql', '/models/orders.sql', 'file')).toBe(true);
	});

	it('allows granted docs files and required ancestors while hiding siblings', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: {
				enforced: true as const,
				access: { mode: 'restricted' as const, grants: [{ kind: 'file' as const, path: 'legal/terms.md' }] },
			},
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		expect(isProjectContextPathAllowed(context, '/docs', '/docs', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/docs/legal', '/docs/legal', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/docs/legal/terms.md', '/docs/legal/terms.md', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/docs/legal/private.md', '/docs/legal/private.md', 'file')).toBe(
			false,
		);
		expect(isProjectContextPathAllowed(context, '/docs/finance', '/docs/finance', 'directory')).toBe(false);
	});

	it('rejects traversal and symlink aliases when lexical and canonical docs paths differ', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: { enforced: true as const, access: { mode: 'all' as const } },
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		expect(isProjectContextPathAllowed(context, '/docs/link.md', '/RULES.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/alias.md', '/docs/real.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/docs/../RULES.md', '/RULES.md', 'file')).toBe(false);
	});

	it('rejects malformed paths without blocking genuine non-docs paths', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: unenforcedDocs,
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		expect(isProjectContextPathAllowed(context, '/notes\u0000.md', '/notes\u0000.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/notes\\private.md', '/notes\\private.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/notes.md', '/notes.md', 'file')).toBe(true);
	});

	it('hides nao_config.yaml wherever it lives and however it is addressed', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: { enforced: false as const },
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		expect(isProjectContextPathAllowed(context, '/nao_config.yaml', '/nao_config.yaml', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, 'nao_config.yaml', '/nao_config.yaml', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/NAO_CONFIG.YAML', '/NAO_CONFIG.YAML', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/alias.yaml', '/nao_config.yaml', 'file')).toBe(false);
		expect(
			isProjectContextPathAllowed(
				context,
				'/repos/other/nao_config.yaml',
				'/repos/other/nao_config.yaml',
				'file',
			),
		).toBe(false);
		expect(isProjectContextPathAllowed(context, '/nao_config.yaml.md', '/nao_config.yaml.md', 'file')).toBe(true);
	});

	it('treats nested docs grant paths as relative to the outer docs root', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: {
				enforced: true as const,
				access: { mode: 'restricted' as const, grants: [{ kind: 'folder' as const, path: 'docs' }] },
			},
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		expect(isProjectContextPathAllowed(context, '/docs/docs/nested.md', '/docs/docs/nested.md', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/docs/other.md', '/docs/other.md', 'file')).toBe(false);
	});

	it('composes docs and warehouse policies', () => {
		const context = {
			warehouseTableAccess: {
				enforced: true as const,
				strict: true,
				tables: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'allowed' }],
			},
			docsContextAccess: { enforced: true as const, access: { mode: 'all' as const } },
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		expect(
			isProjectContextPathAllowed(
				context,
				'/databases/type=postgres/database=app/schema=public/table=allowed/columns.md',
				'/databases/type=postgres/database=app/schema=public/table=allowed/columns.md',
				'file',
			),
		).toBe(true);
		expect(
			isProjectContextPathAllowed(
				context,
				'/databases/type=postgres/database=app/schema=public/table=denied/columns.md',
				'/databases/type=postgres/database=app/schema=public/table=denied/columns.md',
				'file',
			),
		).toBe(false);
	});
});

describe('project file access', () => {
	it('allows every non-docs path, including symlinks within the project, when the group is not restricted on files', () => {
		const context = filesContext({ mode: 'all' as const });
		expect(isProjectContextPathAllowed(context, '/', '/', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/orders.sql', '/models/orders.sql', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/link.sql', '/shared/orders.sql', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/link.md', '/docs/real.md', 'file')).toBe(false);
	});

	it('authorizes granted files and folders while hiding siblings', () => {
		const context = filesContext({
			mode: 'restricted' as const,
			grants: [
				{ kind: 'folder' as const, path: 'models' },
				{ kind: 'file' as const, path: 'README.md' },
			],
		});
		expect(isProjectContextPathAllowed(context, '/', '/', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models', '/models', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/orders.sql', '/models/orders.sql', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/README.md', '/README.md', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/secrets.env', '/secrets.env', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/scripts', '/scripts', 'directory')).toBe(false);
	});

	it('lets granted files be reached through their ancestor folders only', () => {
		const context = filesContext({
			mode: 'restricted' as const,
			grants: [{ kind: 'file' as const, path: 'models/marts/orders.sql' }],
		});
		expect(isProjectContextPathAllowed(context, '/models', '/models', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/marts', '/models/marts', 'directory')).toBe(true);
		expect(
			isProjectContextPathAllowed(context, '/models/marts/orders.sql', '/models/marts/orders.sql', 'file'),
		).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/staging', '/models/staging', 'directory')).toBe(false);
		expect(
			isProjectContextPathAllowed(context, '/models/marts/customers.sql', '/models/marts/customers.sql', 'file'),
		).toBe(false);
	});

	it('keeps the project root listable when no project file is granted, since docs and databases live under it', () => {
		const context = filesContext({ mode: 'restricted' as const, grants: [] });
		expect(isProjectContextPathAllowed(context, '/', '/', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '', '/', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/', '/', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/notes.md', '/notes.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/models', '/models', 'directory')).toBe(false);
	});

	it('keeps docs and project files as independent policies', () => {
		const docsOnly = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: { enforced: true as const, access: { mode: 'all' as const } },
			filesContextAccess: { enforced: true as const, access: { mode: 'restricted' as const, grants: [] } },
			mcpAccess: allMcpAccess,
		};
		expect(
			isProjectContextPathAllowed(docsOnly, '/docs/handbook/leave.md', '/docs/handbook/leave.md', 'file'),
		).toBe(true);
		expect(isProjectContextPathAllowed(docsOnly, '/RULES.md', '/RULES.md', 'file')).toBe(false);

		const filesOnly = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: { enforced: true as const, access: { mode: 'restricted' as const, grants: [] } },
			filesContextAccess: { enforced: true as const, access: { mode: 'all' as const } },
			mcpAccess: allMcpAccess,
		};
		expect(isProjectContextPathAllowed(filesOnly, '/RULES.md', '/RULES.md', 'file')).toBe(true);
		expect(
			isProjectContextPathAllowed(filesOnly, '/docs/handbook/leave.md', '/docs/handbook/leave.md', 'file'),
		).toBe(false);
	});

	it('leaves warehouse context files to the warehouse policy', () => {
		const context = filesContext({ mode: 'restricted' as const, grants: [] });
		expect(
			isProjectContextPathAllowed(
				context,
				'/databases/type=postgres/database=app/schema=public/table=allowed/columns.md',
				'/databases/type=postgres/database=app/schema=public/table=allowed/columns.md',
				'file',
			),
		).toBe(true);
	});

	it('rejects project file traversal and cross-root retargeting', () => {
		const context = filesContext({
			mode: 'restricted' as const,
			grants: [{ kind: 'folder' as const, path: 'models' }],
		});
		expect(isProjectContextPathAllowed(context, '/models/../secrets.env', '/secrets.env', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/models/orders.sql', '/secrets.env', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/RULES.md', '/docs/real.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/models/orders.sql', '/models/orders.sql', 'file')).toBe(true);
	});

	it('hides mcp.json from every user while keeping the tool specs reachable', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: unenforcedDocs,
			filesContextAccess: unenforcedFiles,
			mcpAccess: allMcpAccess,
		};
		const allowed = (requested: string, canonical = requested) =>
			isProjectContextPathAllowed(context, requested, canonical, 'file');

		expect(allowed('/agent/mcps/mcp.json')).toBe(false);
		expect(allowed('/Agent/MCPS/MCP.json')).toBe(false);
		expect(allowed('/agent/./mcps/mcp.json', '/agent/mcps/mcp.json')).toBe(false);
		expect(allowed('/notes/servers.json', '/agent/mcps/mcp.json')).toBe(false);
		expect(allowed('/agent/mcps/github/search.json')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/agent/mcps', '/agent/mcps', 'directory')).toBe(true);
	});

	it('hides the MCP tool specs that the user groups do not grant', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: unenforcedDocs,
			filesContextAccess: unenforcedFiles,
			mcpAccess: {
				mode: 'restricted' as const,
				grants: [
					{ kind: 'server' as const, server: 'linear' },
					{ kind: 'tool' as const, server: 'github', tool: 'list/issues' },
				],
			},
		};
		const allowed = (virtualPath: string, kind: 'file' | 'directory' = 'file') =>
			isProjectContextPathAllowed(context, virtualPath, virtualPath, kind);

		expect(allowed('/agent/mcps', 'directory')).toBe(true);
		expect(allowed('/agent/mcps/mcp.json')).toBe(false);
		expect(allowed('/agent/mcps/linear', 'directory')).toBe(true);
		expect(allowed('/agent/mcps/linear/search.json')).toBe(true);
		expect(allowed('/agent/mcps/github', 'directory')).toBe(true);
		expect(allowed('/agent/mcps/github/list%2Fissues.json')).toBe(true);
		expect(allowed('/agent/mcps/github/create_issue.json')).toBe(false);
		expect(allowed('/agent/mcps/github/nested', 'directory')).toBe(false);
		expect(allowed('/agent/mcps/linear/nested', 'directory')).toBe(false);
		expect(allowed('/agent/mcps/linear/nested/search.json')).toBe(false);
		expect(allowed('/agent/mcps/notes.md')).toBe(false);
		expect(allowed('/agent/mcps/notion', 'directory')).toBe(false);
		expect(allowed('/agent/mcps/notion/search.json')).toBe(false);
		expect(allowed('/Agent/MCPS/notion/search.json')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/models/x.json', '/agent/mcps/notion/search.json', 'file')).toBe(
			false,
		);
	});
});
