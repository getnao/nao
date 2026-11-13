import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	renderColumnSecurityTableFile,
	resetColumnCatalogCacheForTesting,
} from '../../src/services/column-security-context.service';

const temporaryFolders: string[] = [];

afterEach(() => {
	resetColumnCatalogCacheForTesting();
	for (const folder of temporaryFolders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

describe('column security context', () => {
	it('synthesizes columns without denied names or values', () => {
		const projectFolder = createProjectFolder();
		const content = renderColumnSecurityTableFile(
			projectFolder,
			'/databases/type=duckdb/database=analytics/schema=main/table=orders/columns.md',
			{
				enforced: true,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
						restrictedColumns: ['cost'],
						access: 'restricted',
						deniedColumns: ['cost'],
					},
				],
			},
		);

		expect(content).toContain('- id (INTEGER)');
		expect(content).not.toContain('cost');
		expect(content).not.toContain('sensitive description');
	});

	it('refreshes cached catalogs when their freshness signature changes', () => {
		const projectFolder = createProjectFolder();
		const virtualPath = '/databases/type=duckdb/database=analytics/schema=main/table=orders/columns.md';
		const security = {
			enforced: true as const,
			tables: [
				{
					databaseType: 'duckdb',
					database: 'analytics',
					schema: 'main',
					table: 'orders',
					restrictedColumns: ['cost'],
					access: 'restricted' as const,
					deniedColumns: ['cost'],
				},
			],
		};

		expect(renderColumnSecurityTableFile(projectFolder, virtualPath, security)).not.toContain('region');
		writeCatalog(projectFolder, [
			{ name: 'id', type: 'INTEGER' },
			{ name: 'cost', type: 'DECIMAL' },
			{ name: 'region', type: 'VARCHAR' },
		]);

		expect(renderColumnSecurityTableFile(projectFolder, virtualPath, security)).toContain('- region (VARCHAR)');
	});

	it('fails closed when the structured catalog is missing', () => {
		expect(
			renderColumnSecurityTableFile(
				'/missing',
				'/databases/type=duckdb/database=analytics/schema=main/table=orders/columns.md',
				{
					enforced: true,
					tables: [
						{
							databaseType: 'duckdb',
							database: 'analytics',
							schema: 'main',
							table: 'orders',
							restrictedColumns: ['cost'],
							access: 'restricted',
							deniedColumns: ['cost'],
						},
					],
				},
			),
		).toBeNull();
	});
});

function createProjectFolder(): string {
	const projectFolder = join(process.cwd(), `.tmp-column-security-context-${crypto.randomUUID()}`);
	temporaryFolders.push(projectFolder);
	const catalogFolder = join(projectFolder, '.meta/databases/type=duckdb/database=analytics');
	mkdirSync(catalogFolder, { recursive: true });
	writeCatalog(projectFolder, [
		{ name: 'id', type: 'INTEGER' },
		{ name: 'cost', type: 'DECIMAL', description: 'sensitive description' },
	]);
	return projectFolder;
}

function writeCatalog(projectFolder: string, columns: Array<Record<string, string>>): void {
	writeFileSync(
		join(projectFolder, '.meta/databases/type=duckdb/database=analytics/columns.json'),
		JSON.stringify({
			version: 1,
			schemas: {
				main: {
					orders: columns,
				},
			},
		}),
	);
}
