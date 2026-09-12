import { describe, expect, it } from 'vitest';

import { isProjectContextPathAllowed } from '../src/services/project-context-path-access.service';

const unrestrictedWarehouse = { enforced: false as const };

describe('project context path access', () => {
	it('allows unaffected project paths and an unlicensed docs bypass', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: { enforced: false as const },
		};
		expect(isProjectContextPathAllowed(context, '/RULES.md', '/RULES.md', 'file')).toBe(true);
		expect(isProjectContextPathAllowed(context, '/docs/anything.md', '/docs/anything.md', 'file')).toBe(true);
	});

	it('allows granted docs files and required ancestors while hiding siblings', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: {
				enforced: true as const,
				access: { mode: 'restricted' as const, grants: [{ kind: 'file' as const, path: 'legal/terms.md' }] },
			},
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
		};
		expect(isProjectContextPathAllowed(context, '/docs/link.md', '/RULES.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/alias.md', '/docs/real.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/docs/../RULES.md', '/RULES.md', 'file')).toBe(false);
	});

	it('rejects malformed paths without blocking genuine non-docs paths', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: { enforced: false as const },
		};
		expect(isProjectContextPathAllowed(context, '/notes\u0000.md', '/notes\u0000.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/notes\\private.md', '/notes\\private.md', 'file')).toBe(false);
		expect(isProjectContextPathAllowed(context, '/notes.md', '/notes.md', 'file')).toBe(true);
	});

	it('treats nested docs grant paths as relative to the outer docs root', () => {
		const context = {
			warehouseTableAccess: unrestrictedWarehouse,
			docsContextAccess: {
				enforced: true as const,
				access: { mode: 'restricted' as const, grants: [{ kind: 'folder' as const, path: 'docs' }] },
			},
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
