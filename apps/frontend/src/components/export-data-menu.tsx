import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToolCallActions } from '@/contexts/tool-call-actions';
import { useDateFormat } from '@/hooks/use-date-format';
import { downloadCsv, downloadXlsx, tableToCsv } from '@/lib/table-export';

export type DataExportFormat = 'csv' | 'xlsx';

interface ExportDataMenuProps {
	columns: string[];
	data: Record<string, unknown>[];
	/** Exports these rows instead of `data`, which may only be a preview of the result. */
	loadAllRows?: () => Promise<Record<string, unknown>[]>;
	filename: string;
	onExport?: (format: DataExportFormat) => void;
	align?: 'start' | 'end';
	children: ReactElement;
}

export function ExportDataMenu({
	columns,
	data,
	loadAllRows,
	filename,
	onExport,
	align = 'end',
	children,
}: ExportDataMenuProps) {
	const [open, setOpen] = useState(false);
	const toolCallActions = useToolCallActions();
	const dateFormat = useDateFormat();

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		toolCallActions?.setMenuOpen(next);
	};

	const handleExport = async (format: DataExportFormat) => {
		const rows = loadAllRows ? await loadAllRows() : data;
		if (format === 'csv') {
			downloadCsv(`${filename}.csv`, tableToCsv(columns, rows, dateFormat));
		} else {
			await downloadXlsx(`${filename}.xlsx`, columns, rows, dateFormat);
		}
		onExport?.(format);
	};

	return (
		<DropdownMenu open={open} onOpenChange={handleOpenChange}>
			<DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
				{children}
			</DropdownMenuTrigger>
			<DropdownMenuContent align={align}>
				<DropdownMenuItem onSelect={() => handleExport('csv')}>
					<FileSpreadsheet />
					<span>CSV</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => handleExport('xlsx')}>
					<FileSpreadsheet />
					<span>Excel (XLSX)</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
