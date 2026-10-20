import { ArrowRight, BookOpenText, ChevronDown, ShieldCheck } from 'lucide-react';

import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';

export function ExampleProjectInfoCard({ compact = false }: { compact?: boolean }) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant='outline' size='icon-sm' className='rounded-full hover:rounded-full border w-auto px-2'>
					<BookOpenText aria-hidden className='size-3' />
					<span className='text-xs font-medium'>{compact ? 'About Jaffle Shop' : 'Jaffle Shop'}</span>
					{!compact && (
						<ChevronDown
							aria-hidden
							className='size-3 transition-transform group-data-[state=open]:rotate-180'
						/>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align={compact ? 'end' : 'start'}
				sideOffset={8}
				className='max-h-[calc(100dvh-5rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl p-0 shadow-xs'
			>
				<div className='relative flex h-20 items-end overflow-hidden border-b bg-background p-4'>
					<div
						aria-hidden
						className='pointer-events-none absolute inset-0'
						style={{
							backgroundImage:
								'conic-gradient(from 45deg, color-mix(in oklch, oklch(0.58 0.13 265) 3%, var(--background)) 0 25%, color-mix(in oklch, oklch(0.58 0.13 265) 12%, var(--background)) 0 50%, color-mix(in oklch, oklch(0.58 0.13 265) 7%, var(--background)) 0 75%, color-mix(in oklch, oklch(0.58 0.13 265) 1%, var(--background)) 0)',
							backgroundSize: '18px 18px',
						}}
					/>
					<h2 className='font-borna relative text-lg font-medium tracking-tight text-foreground'>
						Jaffle Shop
					</h2>
				</div>
				<div className='p-4'>
					<p className='text-sm leading-relaxed text-muted-foreground'>
						A fictional retail dataset with customers, orders, and payments. Use it to explore nao before
						connecting your own data.
					</p>
					<div className='mt-4 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground'>
						<ShieldCheck aria-hidden className='size-3.5 shrink-0 text-primary' />
						<span>Your own data isn't connected to this chat.</span>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function ExampleProjectPromptCard() {
	return (
		<div className='flex min-h-36 w-full max-w-md flex-col rounded-xl border border-violet/20 bg-background p-4 shadow-xs'>
			<h2 className='font-borna text-base font-medium tracking-tight text-foreground text-violet'>
				Chat with our example project
			</h2>
			<div className='mt-2 divide-y divide-border/60'>
				<ExamplePromptButtons />
			</div>
		</div>
	);
}

function ExamplePromptButtons() {
	const setChatInput = useSetChatInputCallback();

	return (
		<>
			<button
				type='button'
				onClick={() => {
					setChatInput.fire('How is monthly revenue trending?');
				}}
				className='group flex w-full cursor-pointer items-center justify-between gap-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
			>
				<span className='truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground'>
					How is monthly revenue trending?
				</span>
				<PromptArrow />
			</button>
			<button
				type='button'
				onClick={() => {
					setChatInput.fire('Make a chart of our top 5 customers by total revenue.');
				}}
				className='group flex w-full cursor-pointer items-center justify-between gap-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
			>
				<span className='truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground'>
					Make a chart of our top 5 customers by total revenue.
				</span>
				<PromptArrow />
			</button>
			<button
				type='button'
				onClick={() => {
					setChatInput.fire(
						'Create a story, using chart blocks, summarizing our sales performance and key customer trends.',
					);
				}}
				className='group flex w-full cursor-pointer items-center justify-between gap-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
			>
				<span className='truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground'>
					Create a story, using chart blocks, summarizing our sales performance and key customer trends.
				</span>
				<PromptArrow />
			</button>
		</>
	);
}

function PromptArrow() {
	return (
		<ArrowRight className='size-3.5 shrink-0 translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100' />
	);
}
