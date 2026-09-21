import type { ReactNode } from 'react';

export function StoryEmbedFallback({
	dragHandle,
	dragHandlePlacement = 'trailing',
	children,
}: {
	dragHandle?: ReactNode;
	dragHandlePlacement?: 'leading' | 'trailing';
	children: ReactNode;
}) {
	return (
		<div className='my-2 flex flex-col gap-1'>
			{dragHandle != null && (
				<div className={`flex ${dragHandlePlacement === 'leading' ? 'justify-start' : 'justify-end'}`}>
					{dragHandle}
				</div>
			)}
			<div className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				{children}
			</div>
		</div>
	);
}
