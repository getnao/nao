import { ChartNoAxesColumn, MessageCircle, Store, ArrowLeftToLine } from 'lucide-react';
import { useEffect, useState } from 'react';

import StoryIcon from '@/components/ui/story-icon';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

export function ExampleProjectInfoCard() {
	const setChatInput = useSetChatInputCallback();
	const isMobile = useIsMobile();
	const [isOpen, setIsOpen] = useState(!isMobile);

	useEffect(() => {
		setIsOpen(!isMobile);
	}, [isMobile]);

	return (
		<details
			open={isOpen}
			onToggle={(event) => setIsOpen(event.currentTarget.open)}
			className={cn(
				'group overflow-hidden rounded-xl border border-violet/25 bg-background shadow-xs',
				isOpen ? 'w-full max-w-sm max-md:max-w-none' : 'w-fit',
			)}
		>
			<summary
				aria-label={isOpen ? 'Collapse Jaffle Shop information' : 'Expand Jaffle Shop information'}
				title={isOpen ? undefined : 'About the Jaffle Shop example project'}
				className='relative flex cursor-pointer list-none items-center gap-3 p-2 transition-colors hover:bg-muted/30 [&::-webkit-details-marker]:hidden'
			>
				<div className='flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet/20 bg-violet/10 text-primary'>
					<Store aria-hidden className='h-auto w-5 [&_stop]:[stop-color:currentColor]' />
				</div>
				{isOpen && (
					<>
						<h2 className='font-borna text-base font-medium tracking-tight text-foreground'>Jaffle Shop</h2>
						<ArrowLeftToLine
							aria-hidden
							className='absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground'
						/>
					</>
				)}
			</summary>
			<div className='max-h-[calc(100dvh-10rem)] overflow-y-auto'>
				<div className='flex items-start gap-3 p-4'>
					<div className='min-w-0'>
						<p className='text-xs leading-relaxed text-muted-foreground'>
							A fictional retail database designed to let you explore nao before connecting your own data.
						</p>
					</div>
				</div>

				<div className='border-y border-border/60 px-4 py-3'>
					<p className='text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
						Sample data
					</p>
					<p className='mt-1 text-xs leading-relaxed text-foreground/80'>
						Explore a fictional shop's customers, orders, and payments. Analyze purchasing behavior, track
						revenue, compare payment methods, and identify top customers.
					</p>
				</div>

				<div className='grid grid-cols-3 divide-x divide-border/60'>
					<button
						type='button'
						onClick={() => {
							setChatInput.fire('What were our total orders and revenue by month?');
						}}
						className='cursor-pointer flex flex-col items-center gap-1.5 px-2 py-3 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
					>
						<MessageCircle className='size-3.5 text-primary' />
						<span className='text-[11px] text-muted-foreground'>Ask questions</span>
					</button>
					<button
						type='button'
						onClick={() => {
							setChatInput.fire('Make a chart of our top 5 customers by total revenue.');
						}}
						className='cursor-pointer flex flex-col items-center gap-1.5 px-2 py-3 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
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
						className='cursor-pointer flex flex-col items-center gap-1.5 px-2 py-3 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
					>
						<StoryIcon className='size-3.5 text-primary' />
						<span className='text-[11px] text-muted-foreground'>Create stories</span>
					</button>
				</div>

				<div className='border-t border-border/60 bg-muted/30 px-4 py-2.5'>
					<p className='text-[11px] leading-relaxed text-muted-foreground'>
						You're working with sample data—none of your own data is connected to this chat.
					</p>
				</div>
			</div>
		</details>
	);
}
