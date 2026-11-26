import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useIsDarkMode } from '@/contexts/theme.provider';
import { cn } from '@/lib/utils';

export function TrialOnboardingBanner({ variant = 'banner' }: { variant?: 'banner' | 'card' }) {
	const logoSrc = useIsDarkMode() ? '/dark-card-logo.svg' : '/light-card-logo.svg';
	const isCard = variant === 'card';

	return (
		<div className={cn('w-full', !isCard && 'mx-auto max-w-3xl px-3')}>
			<Link to='/onboarding'>
				<div
					className={cn(
						'relative flex overflow-hidden border border-violet/20 bg-background',
						isCard
							? 'min-h-35 flex-col items-start justify-between gap-4 rounded-2xl bg-cover bg-center px-4 py-5 shadow-lg ring-1 ring-violet/10'
							: 'mb-2 flex-col items-stretch gap-3 rounded-xl px-4 py-3 shadow-xs sm:flex-row sm:items-center',
					)}
					style={
						isCard
							? {
									backgroundImage: "url('/trial-onboarding-background.jpg')",
									backgroundSize: 'auto 130%',
								}
							: undefined
					}
				>
					{!isCard && (
						<img
							src={logoSrc}
							alt=''
							aria-hidden
							className='pointer-events-none absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 scale-150 select-none'
						/>
					)}
					<div className='relative z-10 min-w-0 flex-1'>
						<p
							className={cn(
								isCard
									? 'font-borna text-2xl font-semibold leading-[0.95] tracking-[-0.04em] text-white drop-shadow-sm'
									: 'mt-0.5 text-sm font-semibold text-primary',
							)}
						>
							{isCard ? (
								<>
									Start using your
									<br />
									data
								</>
							) : (
								'Start using your data'
							)}
						</p>
						<p
							className={cn(
								isCard
									? 'mt-2 text-xs leading-relaxed text-white/80'
									: 'mt-0.5 text-xs text-muted-foreground',
							)}
						>
							Set up your project with the help of our onboarding agent
						</p>
					</div>
					<Button
						asChild
						size='sm'
						className={cn(
							'relative z-10 shrink-0 rounded-full',
							isCard
								? 'mt-auto w-fit self-end bg-white/20 text-white backdrop-blur hover:bg-white/30'
								: 'self-start bg-primary text-primary-foreground sm:self-center',
						)}
					>
						<span>
							Set up
							<ArrowRight className='size-3.5' />
						</span>
					</Button>
				</div>
			</Link>
		</div>
	);
}
