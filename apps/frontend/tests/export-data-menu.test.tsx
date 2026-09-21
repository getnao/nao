// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as TableExport from '@/lib/table-export';
import { ExportDataMenu } from '@/components/export-data-menu';

vi.mock('@/hooks/use-date-format', () => ({
	useDateFormat: () => ({ preset: 'american' }),
}));

const { downloadCsv, downloadXlsx } = vi.hoisted(() => ({ downloadCsv: vi.fn(), downloadXlsx: vi.fn() }));

vi.mock('@/lib/table-export', async (importOriginal) => ({
	...(await importOriginal<typeof TableExport>()),
	downloadCsv,
	downloadXlsx,
}));

const columns = ['day', 'label'];
const data = [{ day: '2024-03-15', label: 'launch' }];

describe('ExportDataMenu', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('exports CSV using the project date format', async () => {
		renderMenu();
		await selectMenuItem('CSV');

		expect(downloadCsv).toHaveBeenCalledWith('sales.csv', 'day,label\n03/15/2024,launch');
	});

	it('exports XLSX using the project date format', async () => {
		renderMenu();
		await selectMenuItem('Excel (XLSX)');

		expect(downloadXlsx).toHaveBeenCalledWith('sales.xlsx', columns, data, { preset: 'american' });
	});
});

function renderMenu() {
	render(
		<ExportDataMenu columns={columns} data={data} filename='sales'>
			<button type='button'>Export</button>
		</ExportDataMenu>,
	);
}

async function selectMenuItem(label: string) {
	fireEvent.pointerDown(screen.getByRole('button', { name: 'Export' }), { button: 0, ctrlKey: false });
	fireEvent.click(await screen.findByText(label));
}
