import { BookOpenText, ChevronDown, ShieldCheck } from 'lucide-react';

import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
