import * as React from 'react';

import { cn } from '@/lib/utils';

function Table({ className, ...props }: React.ComponentProps<'table'>) {
	return (
		<div data-slot='table-container' className='relative w-full overflow-auto overscroll-none h-full'>
			<table
				data-slot='table'
				className={cn('w-full caption-bottom text-sm border-separate border-spacing-0', className)}
				{...props}
			/>
		</div>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
	return (
		<thead
			data-slot='table-header'
			className={cn('[&_tr]:shadow-[inset_0_-1px_0_var(--color-border)]', className)}
			{...props}
		/>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
	return <tbody data-slot='table-body' className={cn('[&_tr:last-child]:shadow-none', className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
	return (
		<tfoot
			data-slot='table-footer'
			className={cn(
				'bg-muted/50 shadow-[inset_0_1px_0_var(--color-border)] font-medium [&>tr]:last:shadow-none',
				className,
			)}
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
	return (
		<tr
			data-slot='table-row'
			className={cn(
				'hover:bg-muted/50 data-[state=selected]:bg-muted shadow-[inset_0_-1px_0_var(--color-border)] transition-colors',
				className,
			)}
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
	return (
		<th
			data-slot='table-head'
			className={cn(
				'text-foreground h-9 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
				className,
			)}
			{...props}
		/>
	);
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
	return (
		<td
			data-slot='table-cell'
			className={cn(
				'p-2 align-middle h-9 whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
				className,
			)}
			{...props}
		/>
	);
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
	return (
		<caption data-slot='table-caption' className={cn('text-muted-foreground mt-4 text-sm', className)} {...props} />
	);
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
