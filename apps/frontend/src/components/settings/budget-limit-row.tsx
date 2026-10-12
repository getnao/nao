interface BudgetLimitRowProps {
	description: string;
	unitLabel: string;
	children: React.ReactNode;
}

export function BudgetLimitRow({ description, unitLabel, children }: BudgetLimitRowProps) {
	return (
		<div className='flex items-center justify-between gap-4 rounded-lg border p-3'>
			<div>
				<p className='text-sm font-medium'>Limit</p>
				<p className='text-xs text-muted-foreground'>{description}</p>
			</div>
			<div className='flex items-center gap-1.5'>
				{children}
				<span className='text-sm text-muted-foreground whitespace-nowrap'>{unitLabel}</span>
			</div>
		</div>
	);
}
