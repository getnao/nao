import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { renderColumnSecurityTableFile } from '../src/services/column-security-context.service';

const temporaryFolders: string[] = [];

afterEach(() => {
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
	writeFileSync(
		join(catalogFolder, 'columns.json'),
		JSON.stringify({
			version: 1,
			schemas: {
				main: {
					orders: [
						{ name: 'id', type: 'INTEGER' },
						{ name: 'cost', type: 'DECIMAL', description: 'sensitive description' },
					],
				},
			},
		}),
	);
	return projectFolder;
}
