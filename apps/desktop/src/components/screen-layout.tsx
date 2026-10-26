import type { ReactNode } from 'react';

import { NaoLogo } from '@/components/nao-logo';

export function ScreenLayout({
	title,
	description,
	children,
}: {
	title: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<main className='flex h-full flex-col items-center overflow-y-auto px-6 py-12'>
			<div className='my-auto flex w-full max-w-md flex-col gap-8'>
				<div className='flex flex-col items-center gap-5 text-center'>
					<NaoLogo className='h-auto w-14' />
					<div className='flex flex-col gap-2'>
						<h1 className='text-2xl font-medium'>{title}</h1>
						{description && <p className='text-sm text-muted-foreground'>{description}</p>}
					</div>
				</div>
				{children}
			</div>
		</main>
	);
}

export function Panel({ children }: { children: ReactNode }) {
	return <div className='flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm'>{children}</div>;
}
