import { FileSpreadsheet } from 'lucide-react';
import { memo } from 'react';
import { rowsToCsvString, sanitizeCsvBasename } from '@nao/shared/csv';
import { Button } from '@/components/ui/button';

export const ChartDataCsvExportButton = memo(function ChartDataCsvExportButton({
	columns,
	data,
	title,
}: {
	columns?: string[];
	data: Record<string, unknown>[];
	title?: string;
}) {
	const handleClick = () => {
		const csv = rowsToCsvString(columns, data);
		if (!csv) {
			return;
		}
		const basename = sanitizeCsvBasename(title, 'chart');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${basename}.csv`;
		anchor.click();
		URL.revokeObjectURL(url);
	};

	return (
		<Button
			type='button'
			variant='ghost-muted'
			size='icon-xs'
			disabled={data.length === 0}
			onClick={handleClick}
			title='Export CSV'
		>
			<FileSpreadsheet className='size-3.5' />
		</Button>
	);
});
