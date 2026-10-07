import { ChartNoAxesColumn, MessageCircle } from 'lucide-react';

import NaoLogo from '@/components/icons/nao-logo.svg';
import StoryIcon from '@/components/ui/story-icon';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';

export function ExampleProjectInfoCard() {
	const setChatInput = useSetChatInputCallback();

	return (
		<aside className='w-full max-w-sm overflow-hidden rounded-xl border border-violet/25 bg-background shadow-xs max-md:max-w-none'>
			<div className='flex items-start gap-3 p-4'>
				<div className='flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet/20 bg-violet/10 text-primary'>
					<NaoLogo aria-hidden className='h-auto w-5 [&_stop]:[stop-color:currentColor]' />
				</div>
				<div className='min-w-0'>
					<h2 className='font-borna text-base font-medium tracking-tight text-foreground'>Jaffle Shop</h2>
					<p className='mt-1.5 text-xs leading-relaxed text-muted-foreground'>
						A fictional retail database designed to let you explore nao before connecting your own data.
					</p>
				</div>
			</div>

			<div className='border-y border-border/60 px-4 py-3'>
				<p className='text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
					Sample data
				</p>
				<p className='mt-1 text-xs leading-relaxed text-foreground/80'>
					Explore a fictional shop&apos;s customers, orders, and payments. Analyze purchasing behavior, track
					revenue, compare payment methods, and identify top customers.
				</p>
			</div>

			<div className='grid grid-cols-3 divide-x divide-border/60'>
				<button
					type='button'
					onClick={() => {
						setChatInput.fire('What were our total orders and revenue by month?');
					}}
					className='flex flex-col items-center gap-1.5 px-2 py-3 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
				>
					<MessageCircle className='size-3.5 text-primary' />
					<span className='text-[11px] text-muted-foreground'>Ask questions</span>
				</button>
				<button
					type='button'
					onClick={() => {
						setChatInput.fire('Make a chart of our top 5 customers by total revenue.');
					}}
					className='flex flex-col items-center gap-1.5 px-2 py-3 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
				>
					<ChartNoAxesColumn className='size-3.5 text-primary' />
					<span className='text-[11px] text-muted-foreground'>Build charts</span>
				</button>
				<button
					type='button'
					onClick={() => {
						setChatInput.fire(
							'Create a story, using chart blocks, summarizing our sales performance and key customer trends.',
						);
					}}
					className='flex flex-col items-center gap-1.5 px-2 py-3 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
				>
					<StoryIcon className='size-3.5 text-primary' />
					<span className='text-[11px] text-muted-foreground'>Create stories</span>
				</button>
			</div>

			<div className='border-t border-border/60 bg-muted/30 px-4 py-2.5'>
				<p className='text-[11px] leading-relaxed text-muted-foreground'>
					You&apos;re working with sample data—none of your own data is connected.
				</p>
			</div>
		</aside>
	);
}
