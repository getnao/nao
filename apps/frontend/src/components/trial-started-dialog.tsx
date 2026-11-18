import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatMicroUsd } from '@nao/shared/billing';

import { ConfettiBurst } from '@/components/confetti-burst';
import { NyanCat } from '@/components/icons/nyan-cat';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const COUNT_UP_DURATION_MS = 900;
const seenSetupCreditGrantsStorage = createLocalStorage<string[]>('nao-seen-setup-credit-grants', []);

interface TrialStartedDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	creditAmountMicroUsd: number;
	userName?: string | null;
}

export function TrialStartedDialogController() {
	const { isOrgAdmin } = usePermissions();
	const { data: session } = useSession();
	const setupCreditGrant = useQuery({
		...trpc.account.getOrganizationSetupCreditGrant.queryOptions(),
		enabled: isOrgAdmin,
		staleTime: 0,
	});
	const [seenGrantIds, setSeenGrantIds] = useState(getSeenSetupCreditGrantIds);
	const grant = setupCreditGrant.data;
	const open = isOrgAdmin && grant !== null && grant !== undefined && !seenGrantIds.includes(grant.id);

	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen || !grant) {
			return;
		}
		const nextSeenGrantIds = [...new Set([...getSeenSetupCreditGrantIds(), grant.id])];
		seenSetupCreditGrantsStorage.set(nextSeenGrantIds);
		setSeenGrantIds(nextSeenGrantIds);
	};

	if (!grant) {
		return null;
	}

	return (
		<TrialStartedDialog
			open={open}
			onOpenChange={handleOpenChange}
			creditAmountMicroUsd={grant.amountMicroUsd}
			userName={session?.user.name}
		/>
	);
}

export function TrialStartedDialog({ open, onOpenChange, creditAmountMicroUsd, userName }: TrialStartedDialogProps) {
	const firstName = userName?.trim().split(/\s+/)[0];
	const formattedCreditAmount = formatCreditAmount(creditAmountMicroUsd, creditAmountMicroUsd);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className='overflow-hidden border-violet/20 p-0 sm:max-w-xl'>
				<NyanCatSky />
				<div className='flex flex-col items-center px-8 pb-8 text-center sm:px-12'>
					<span
						className={cn(enterClass, 'text-[10px] font-semibold uppercase tracking-[0.18em] text-violet')}
					>
						{firstName ? `You’re in, ${firstName}` : 'You’re in'}
					</span>
					<DialogHeader className='mt-3 items-center gap-3'>
						<DialogTitle
							className={cn(
								enterClass,
								'[animation-delay:80ms] font-borna text-3xl font-medium tracking-tight sm:text-4xl',
							)}
						>
							Welcome to nao Cloud
						</DialogTitle>
						<DialogDescription
							className={cn(enterClass, '[animation-delay:160ms] max-w-md text-center leading-relaxed')}
						>
							We’ve added {formattedCreditAmount} of nao credits so your team can start asking questions
							right away.
						</DialogDescription>
					</DialogHeader>
					<div className={cn(enterClass, '[animation-delay:260ms] relative my-8 flex flex-col items-center')}>
						<ConfettiBurst delayMs={COUNT_UP_DURATION_MS - 150} />
						<span className='relative font-borna text-6xl font-medium tracking-tight text-violet tabular-nums'>
							<CountUp toMicroUsd={creditAmountMicroUsd} durationMs={COUNT_UP_DURATION_MS} />
						</span>
						<span className='relative mt-1 text-sm font-medium text-foreground'>
							Free nao credits, ready to use
						</span>
					</div>
					<Button
						asChild
						variant='primary-gradient'
						size='lg'
						className={cn(enterClass, '[animation-delay:380ms] group rounded-full px-8')}
					>
						<Link to='/' onClick={() => onOpenChange(false)}>
							Ask your first question
							<ArrowRight className='size-4 transition-transform group-hover:translate-x-0.5' />
						</Link>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

const enterClass = 'animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500 motion-reduce:animate-none';

function NyanCatSky() {
	return (
		<div aria-hidden='true' className='relative h-16 overflow-hidden sm:h-20'>
			<div className='nyan-cat-flight absolute bottom-0 left-0 top-3 flex w-full items-center [--cat-width:7rem]'>
				<NyanCat className='h-auto w-[var(--cat-width)] shrink-0' />
			</div>
		</div>
	);
}

function CountUp({ toMicroUsd, durationMs }: { toMicroUsd: number; durationMs: number }) {
	const [value, setValue] = useState(prefersReducedMotion() ? toMicroUsd : 0);

	useEffect(() => {
		if (prefersReducedMotion()) {
			return;
		}
		let frame = 0;
		const start = performance.now();
		const tick = (now: number) => {
			const progress = Math.min((now - start) / durationMs, 1);
			setValue(Math.round(toMicroUsd * easeOutCubic(progress)));
			if (progress < 1) {
				frame = requestAnimationFrame(tick);
			}
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [toMicroUsd, durationMs]);

	return <>{formatCreditAmount(value, toMicroUsd)}</>;
}

function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function formatCreditAmount(amountMicroUsd: number, finalAmountMicroUsd: number): string {
	const showCents = finalAmountMicroUsd % 1_000_000 !== 0;
	return formatMicroUsd(amountMicroUsd, {
		locale: 'en-US',
		minimumFractionDigits: showCents ? 2 : 0,
		maximumFractionDigits: showCents ? 2 : 0,
	});
}

function getSeenSetupCreditGrantIds(): string[] {
	const grantIds = seenSetupCreditGrantsStorage.get();
	return Array.isArray(grantIds) ? grantIds : [];
}
