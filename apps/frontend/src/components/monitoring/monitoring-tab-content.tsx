import type { ReactNode } from 'react';

export function MonitoringTabContent({ children }: { children: ReactNode }) {
	return (
		<div className='flex-1 overflow-auto [scrollbar-gutter:stable]'>
			<div className='mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 md:px-8 md:py-6'>{children}</div>
		</div>
	);
}

export function MonitoringGrid({
	children,
	layout,
}: {
	children: ReactNode;
	layout: 'halves' | 'two-one' | 'one-two';
}) {
	const columns = {
		halves: 'lg:grid-cols-2',
		'two-one': 'lg:grid-cols-[2fr_1fr]',
		'one-two': 'lg:grid-cols-[1fr_2fr]',
	}[layout];
	return <div className={`grid grid-cols-1 gap-3 ${columns}`}>{children}</div>;
}
