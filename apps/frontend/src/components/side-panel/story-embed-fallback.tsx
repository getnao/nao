import type { ReactNode } from 'react';

export function StoryEmbedFallback({ dragHandle, children }: { dragHandle?: ReactNode; children: ReactNode }) {
	return (
		<div className='my-2 flex flex-col gap-1'>
			{dragHandle != null && <div className='flex justify-end'>{dragHandle}</div>}
			<div className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				{children}
			</div>
		</div>
	);
}
