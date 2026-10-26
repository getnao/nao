import { Download } from 'lucide-react';
import { LibraryItemIcon } from './library-item-icon';
import type { LibraryItem, MockFilePreview } from '@/lib/library';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { describeLibraryItem } from '@/lib/library';

export function LibraryFilePreview({ item, preview }: { item: LibraryItem; preview: MockFilePreview }) {
	return (
		<div className='flex h-full min-h-0 flex-col'>
			<div className='flex shrink-0 items-center gap-3 border-b px-4 py-2.5'>
				<LibraryItemIcon item={item} className='size-4' />
				<span className='flex-1 truncate text-xs text-muted-foreground'>{describeLibraryItem(item)}</span>
				<Button variant='outline' size='sm' className='h-7 gap-1.5 rounded-full text-xs'>
					<Download className='size-3' />
					Download
				</Button>
			</div>
			<div className='min-h-0 flex-1 overflow-auto'>
				{preview.kind === 'table' ? <TablePreview preview={preview} /> : <SlidesPreview preview={preview} />}
			</div>
		</div>
	);
}

function TablePreview({ preview }: { preview: Extract<MockFilePreview, { kind: 'table' }> }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					{preview.columns.map((column) => (
						<TableHead key={column} className='px-4 font-mono text-xs'>
							{column}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{preview.rows.map((row, index) => (
					<TableRow key={index}>
						{preview.columns.map((column) => (
							<TableCell key={column} className='px-4 tabular-nums'>
								{formatCell(row[column])}
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function SlidesPreview({ preview }: { preview: Extract<MockFilePreview, { kind: 'slides' }> }) {
	return (
		<div className='grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-4'>
			{preview.slides.map((slide, index) => (
				<div key={slide.title} className='flex flex-col gap-1.5'>
					<div className='flex aspect-video flex-col justify-end rounded-lg border bg-gradient-to-br from-violet/10 to-background p-4'>
						<span className='text-sm font-semibold'>{slide.title}</span>
					</div>
					<span className='text-xs text-muted-foreground'>
						{index + 1}. {slide.caption}
					</span>
				</div>
			))}
		</div>
	);
}

function formatCell(value: unknown): string {
	return typeof value === 'number' ? value.toLocaleString() : String(value ?? '');
}
