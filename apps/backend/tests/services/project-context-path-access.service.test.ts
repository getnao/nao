import type { DocsContextAccess, FilesContextAccess } from '@nao/shared';
import { describe, expect, it } from 'vitest';

import { isProjectContextPathAllowed } from '../../src/services/project-context-path-access.service';

type PathAccessContext = Parameters<typeof isProjectContextPathAllowed>[0];
type PathKind = Parameters<typeof isProjectContextPathAllowed>[3];

const ALLOWED_TABLE_COLUMNS = '/databases/type=postgres/database=app/schema=public/table=allowed/columns.md';
const DENIED_TABLE_COLUMNS = '/databases/type=postgres/database=app/schema=public/table=denied/columns.md';

describe('project context path access', () => {
	it('allows unaffected project paths and an unlicensed docs bypass', () => {
		const context = pathAccessContext();
		expect(isPathAllowed(context, '/RULES.md', 'file')).toBe(true);
		expect(isPathAllowed(context, '/docs/anything.md', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/alias.sql', '/models/orders.sql', 'file')).toBe(true);
	});

	it('allows granted docs files and required ancestors while hiding siblings', () => {
		const context = docsContext({ mode: 'restricted', grants: [{ kind: 'file', path: 'legal/terms.md' }] });
		expect(isPathAllowed(context, '/docs', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/docs/legal', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/docs/legal/terms.md', 'file')).toBe(true);
		expect(isPathAllowed(context, '/docs/legal/private.md', 'file')).toBe(false);
		expect(isPathAllowed(context, '/docs/finance', 'directory')).toBe(false);
	});

	it('rejects traversal and symlink aliases when lexical and canonical docs paths differ', () => {
		const context = docsContext({ mode: 'all' });
		expect(isProjectContextPathAllowed(context, '/docs/link.md', '/RULES.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/alias.md', '/docs/real.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/docs/../RULES.md', '/RULES.md', 'file')).toBe(false);
	});

	it('rejects malformed paths without blocking genuine non-docs paths', () => {
		const context = pathAccessContext();
		expect(isPathAllowed(context, '/notes\u0000.md', 'file')).toBe(false);
		expect(isPathAllowed(context, '/notes\\private.md', 'file')).toBe(false);
		expect(isPathAllowed(context, '/notes.md', 'file')).toBe(true);
	});

	it('hides nao_config.yaml wherever it lives and however it is addressed', () => {
		const context = pathAccessContext();
		expect(isPathAllowed(context, '/nao_config.yaml', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, 'nao_config.yaml', '/nao_config.yaml', 'file')).toBe(false);
		expect(isPathAllowed(context, '/NAO_CONFIG.YAML', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/alias.yaml', '/nao_config.yaml', 'file')).toBe(false);
		expect(isPathAllowed(context, '/repos/other/nao_config.yaml', 'file')).toBe(false);
		expect(isPathAllowed(context, '/nao_config.yaml.md', 'file')).toBe(true);
	});

	it('treats nested docs grant paths as relative to the outer docs root', () => {
		const context = docsContext({ mode: 'restricted', grants: [{ kind: 'folder', path: 'docs' }] });
		expect(isPathAllowed(context, '/docs/docs/nested.md', 'file')).toBe(true);
		expect(isPathAllowed(context, '/docs/other.md', 'file')).toBe(false);
	});

	it('composes docs and warehouse policies', () => {
		const context = pathAccessContext({
			warehouseTableAccess: {
				enforced: true,
				strict: true,
				tables: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'allowed' }],
			},
			docsContextAccess: { enforced: true, access: { mode: 'all' } },
		});
		expect(isPathAllowed(context, ALLOWED_TABLE_COLUMNS, 'file')).toBe(true);
		expect(isPathAllowed(context, DENIED_TABLE_COLUMNS, 'file')).toBe(false);
	});
});

describe('project file access', () => {
	it('allows every non-docs path, including symlinks within the project, when the group is not restricted on files', () => {
		const context = filesContext({ mode: 'all' });
		expect(isPathAllowed(context, '/', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/models/orders.sql', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/link.sql', '/shared/orders.sql', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/models/link.md', '/docs/real.md', 'file')).toBe(false);
	});

	it('authorizes granted files and folders while hiding siblings', () => {
		const context = filesContext({
			mode: 'restricted',
			grants: [
				{ kind: 'folder', path: 'models' },
				{ kind: 'file', path: 'README.md' },
			],
		});
		expect(isPathAllowed(context, '/', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/models', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/models/orders.sql', 'file')).toBe(true);
		expect(isPathAllowed(context, '/README.md', 'file')).toBe(true);
		expect(isPathAllowed(context, '/secrets.env', 'file')).toBe(false);
		expect(isPathAllowed(context, '/scripts', 'directory')).toBe(false);
	});

	it('lets granted files be reached through their ancestor folders only', () => {
		const context = filesContext({
			mode: 'restricted',
			grants: [{ kind: 'file', path: 'models/marts/orders.sql' }],
		});
		expect(isPathAllowed(context, '/models', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/models/marts', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/models/marts/orders.sql', 'file')).toBe(true);
		expect(isPathAllowed(context, '/models/staging', 'directory')).toBe(false);
		expect(isPathAllowed(context, '/models/marts/customers.sql', 'file')).toBe(false);
	});

	it('keeps the project root listable when no project file is granted, since docs and databases live under it', () => {
		const context = filesContext({ mode: 'restricted', grants: [] });
		expect(isPathAllowed(context, '/', 'directory')).toBe(true);
		expect(isProjectContextPathAllowed(context, '', '/', 'directory')).toBe(true);
		expect(isPathAllowed(context, '/', 'file')).toBe(false);
		expect(isPathAllowed(context, '/notes.md', 'file')).toBe(false);
		expect(isPathAllowed(context, '/models', 'directory')).toBe(false);
	});

	it('keeps docs and project files as independent policies', () => {
		const docsOnly = pathAccessContext({
			docsContextAccess: { enforced: true, access: { mode: 'all' } },
			filesContextAccess: { enforced: true, access: { mode: 'restricted', grants: [] } },
		});
		expect(isPathAllowed(docsOnly, '/docs/handbook/leave.md', 'file')).toBe(true);
		expect(isPathAllowed(docsOnly, '/RULES.md', 'file')).toBe(false);

		const filesOnly = pathAccessContext({
			docsContextAccess: { enforced: true, access: { mode: 'restricted', grants: [] } },
			filesContextAccess: { enforced: true, access: { mode: 'all' } },
		});
		expect(isPathAllowed(filesOnly, '/RULES.md', 'file')).toBe(true);
		expect(isPathAllowed(filesOnly, '/docs/handbook/leave.md', 'file')).toBe(false);
	});

	it('leaves warehouse context files to the warehouse policy', () => {
		const context = filesContext({ mode: 'restricted', grants: [] });
		expect(isPathAllowed(context, ALLOWED_TABLE_COLUMNS, 'file')).toBe(true);
	});

	it('rejects project file traversal and cross-root retargeting', () => {
		const context = filesContext({ mode: 'restricted', grants: [{ kind: 'folder', path: 'models' }] });
		expect(isProjectContextPathAllowed(context, '/models/../secrets.env', '/secrets.env', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/models/orders.sql', '/secrets.env', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/RULES.md', '/docs/real.md', 'file')).toBe(false);
		expect(isPathAllowed(context, '/models/orders.sql', 'file')).toBe(true);
	});
});

/** Requests a path that is not an alias, so its lexical and canonical forms are the same. */
function isPathAllowed(context: PathAccessContext, virtualPath: string, kind: PathKind): boolean {
	return isProjectContextPathAllowed(context, virtualPath, virtualPath, kind);
}

function pathAccessContext(overrides: Partial<PathAccessContext> = {}): PathAccessContext {
	return {
		warehouseTableAccess: { enforced: false },
		docsContextAccess: { enforced: false },
		filesContextAccess: { enforced: false },
		...overrides,
	};
}

function docsContext(access: DocsContextAccess): PathAccessContext {
	return pathAccessContext({ docsContextAccess: { enforced: true, access } });
}

function filesContext(access: FilesContextAccess): PathAccessContext {
	return pathAccessContext({ filesContextAccess: { enforced: true, access } });
}
