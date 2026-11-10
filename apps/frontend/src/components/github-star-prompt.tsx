import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConfettiBurst } from '@/components/confetti-burst';
import GithubIcon from '@/components/icons/github-icon.svg';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useUserIdle } from '@/hooks/use-user-idle';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const REPOSITORY_URL = 'https://github.com/getnao/nao';
const IDLE_BEFORE_ASKING_MS = 15_000;
const THANKS_DURATION_MS = 2_500;
const LEAVE_DURATION_MS = 300;

type PromptPhase = 'open' | 'leaving' | 'closed';

/** Asks open-source users for a GitHub star, once they paused for a moment, until they close it. */
export function GithubStarPrompt() {
	const isMobile = useIsMobile();
	const prompt = useQuery(trpc.user.getGithubStarPrompt.queryOptions());
	const isEligible = prompt.data?.shouldShow === true && !isMobile;
	const hasBeenIdle = useUserIdle({ enabled: isEligible, delayMs: IDLE_BEFORE_ASKING_MS });
	const { phase, hasStarred, star, close } = useGithubStarPromptState();

	const hasAnswered = hasStarred || phase !== 'open';
	const isVisible = phase !== 'closed' && (hasAnswered || (isEligible && hasBeenIdle));
	if (!isVisible) {
		return null;
	}

	return (
		<aside
			aria-label='Star nao on GitHub'
			className={cn(
				'fixed right-4 bottom-4 z-40 w-80 overflow-hidden rounded-2xl border bg-background p-1.5 shadow-lg',
				'animate-in fade-in slide-in-from-bottom-6 duration-500 ease-out motion-reduce:animate-none',
				phase === 'leaving' && 'animate-out fade-out slide-out-to-bottom-6 duration-300 fill-mode-forwards',
			)}
		>
			{hasStarred ? <ThanksContent /> : <AskContent onStar={star} onClose={close} />}
		</aside>
	);
}

function useGithubStarPromptState() {
	const [phase, setPhase] = useState<PromptPhase>('open');
	const [hasStarred, setHasStarred] = useState(false);
	const queryClient = useQueryClient();
	const dismiss = useMutation(
		trpc.user.dismissGithubStarPrompt.mutationOptions({
			onMutate: () => {
				queryClient.setQueryData(trpc.user.getGithubStarPrompt.queryKey(), { shouldShow: false });
			},
		}),
	);

	useEffect(() => {
		if (phase === 'leaving') {
			const timer = window.setTimeout(() => setPhase('closed'), LEAVE_DURATION_MS);
			return () => window.clearTimeout(timer);
		}
		if (phase === 'open' && hasStarred) {
			const timer = window.setTimeout(() => setPhase('leaving'), THANKS_DURATION_MS);
			return () => window.clearTimeout(timer);
		}
	}, [phase, hasStarred]);

	const star = () => {
		dismiss.mutate();
		setHasStarred(true);
	};

	const close = () => {
		dismiss.mutate();
		setPhase('leaving');
	};

	return { phase, hasStarred, star, close };
}

function AskContent({ onStar, onClose }: { onStar: () => void; onClose: () => void }) {
	return (
		<>
			<div className='px-3 pt-3 pb-4'>
				<div className='flex items-center justify-between'>
					<span className='rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium'>Open source</span>
					<Button variant='ghost-muted' size='icon-xs' aria-label='Close' onClick={onClose}>
						<X />
					</Button>
				</div>
				<h2 className='mt-3 text-base font-medium tracking-tight text-foreground'>Enjoying nao?</h2>
				<p className='mt-1.5 text-sm leading-relaxed text-muted-foreground'>
					nao is free and open source. A star on GitHub helps more data teams find it and keeps us building.
				</p>
			</div>
			<StarRepositoryPanel onStar={onStar} />
		</>
	);
}

function StarRepositoryPanel({ onStar }: { onStar: () => void }) {
	return (
		<a
			href={REPOSITORY_URL}
			target='_blank'
			rel='noopener noreferrer'
			onClick={onStar}
			className='group relative flex h-32 flex-col justify-between overflow-hidden rounded-xl bg-brand-gradient p-4 text-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
		>
			<div
				aria-hidden
				className='pointer-events-none absolute inset-0 opacity-20'
				style={{
					backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
					backgroundSize: '14px 14px',
				}}
			/>
			<GithubIcon
				aria-hidden
				className='pointer-events-none absolute -right-6 -bottom-8 size-36 text-white opacity-15 transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105'
			/>
			<span className='relative font-mono text-xs text-white/80'>getnao/nao</span>
			<span className='relative inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm transition-transform group-hover:-translate-y-0.5'>
				<Star className='size-3.5 fill-amber-400 text-amber-400' />
				Star on GitHub
				<ArrowUpRight className='size-3.5 text-neutral-500' />
			</span>
		</a>
	);
}

function ThanksContent() {
	return (
		<div className='relative flex flex-col items-center px-4 py-8 text-center' role='status'>
			<div className='relative'>
				<ConfettiBurst count={18} distancePx={64} />
				<Star className='thumb-up-pop size-8 fill-amber-400 text-amber-400' />
			</div>
			<h2 className='mt-4 text-base font-medium tracking-tight text-foreground'>Thanks for the star!</h2>
			<p className='mt-1 text-sm text-muted-foreground'>It really helps nao grow.</p>
		</div>
	);
}
