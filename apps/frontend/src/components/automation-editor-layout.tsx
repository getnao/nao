import type { ReactNode } from 'react';

import { MobileHeader } from '@/components/mobile-header';

/** The page of an automation's form, with its editing chat along the right edge. */
export function AutomationEditorLayout({ chatPanel, children }: { chatPanel: ReactNode; children: ReactNode }) {
	return (
		<div className='relative flex h-full min-w-0 flex-1 bg-panel'>
			<div className='flex min-w-0 flex-1 flex-col overflow-auto'>
				<MobileHeader />
				<div className='mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8'>{children}</div>
			</div>
			{chatPanel}
		</div>
	);
}
