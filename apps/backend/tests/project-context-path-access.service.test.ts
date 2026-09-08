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
