import { describe, expect, it } from 'vitest';

import { findTableAnnotations } from '../../src/services/table-annotations.service';

const COLUMNS_PATH = '/databases/type=duckdb/database=db/schema=main/table=orders/columns.md';
const ANNOTATIONS_PATH = '/databases/type=duckdb/database=db/schema=main/table=orders/annotations.md';
const MANUAL_MARKER = '---\ntype: manual\ncomment: These are manual notes.\n---\n';

describe('findTableAnnotations', () => {
	it('returns the sibling annotations without their frontmatter', async () => {
		const annotations = await findTableAnnotations(
			COLUMNS_PATH,
			readFrom({ [ANNOTATIONS_PATH]: `${MANUAL_MARKER}\nExclude test orders.\n` }),
		);

		expect(annotations).toEqual({ path: ANNOTATIONS_PATH, content: 'Exclude test orders.' });
	});

	it('ignores annotations that only contain the marker', async () => {
		const annotations = await findTableAnnotations(COLUMNS_PATH, readFrom({ [ANNOTATIONS_PATH]: MANUAL_MARKER }));

		expect(annotations).toBeUndefined();
	});

	it('ignores missing annotations', async () => {
		await expect(findTableAnnotations(COLUMNS_PATH, readFrom({}))).resolves.toBeUndefined();
	});

	it('only applies to table columns files', async () => {
		const read = readFrom({ '/docs/annotations.md': 'notes' });

		await expect(findTableAnnotations('/docs/columns.md', read)).resolves.toBeUndefined();
		await expect(
			findTableAnnotations(
				COLUMNS_PATH.replace('columns.md', 'preview.md'),
				readFrom({ [ANNOTATIONS_PATH]: 'notes' }),
			),
		).resolves.toBeUndefined();
	});

	it.each([COLUMNS_PATH.slice(1), `.${COLUMNS_PATH}`, `/docs/..${COLUMNS_PATH}`])(
		'normalizes %s before matching',
		async (columnsPath) => {
			const annotations = await findTableAnnotations(columnsPath, readFrom({ [ANNOTATIONS_PATH]: 'notes' }));

			expect(annotations).toEqual({ path: ANNOTATIONS_PATH, content: 'notes' });
		},
	);
});

function readFrom(files: Record<string, string>) {
	return async (filePath: string) => {
		if (!(filePath in files)) {
			throw new Error(`ENOENT: ${filePath}`);
		}
		return files[filePath];
	};
}
