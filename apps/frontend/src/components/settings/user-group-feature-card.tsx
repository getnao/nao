import { ArrowRight, Check, Clock3, FileText, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { UserGroupFeature } from '@nao/shared';

import { GRID_CARD_CLASS } from '@/components/item-card';
import { cn } from '@/lib/utils';

interface UserGroupFeatureDefinition {
	key: UserGroupFeature;
	label: string;
	description: string;
}

interface UserGroupFeatureCardProps {
	feature: UserGroupFeatureDefinition;
	selected: boolean;
	onSelectedChange: (selected: boolean) => void;
}

export function UserGroupFeatureCard({ feature, selected, onSelectedChange }: UserGroupFeatureCardProps) {
	return (
		<button
			type='button'
			aria-label={`${feature.label}. ${feature.description}`}
			aria-pressed={selected}
			onClick={() => onSelectedChange(!selected)}
			className={cn(
				GRID_CARD_CLASS,
				'h-[120px] w-full cursor-pointer text-left transition-colors',
				'hover:border-primary/40 hover:bg-accent/20',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
				selected && 'border-primary bg-primary/[0.04] ring-1 ring-primary/40 hover:bg-primary/[0.06]',
			)}
		>
			<UserGroupFeatureCardContent
				feature={feature}
				status={
					<div
						className={cn(
							'absolute right-2 top-2 z-10 flex size-5 items-center justify-center rounded-full border bg-background/90 transition-colors',
							selected
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border text-transparent',
						)}
						aria-hidden='true'
					>
						<Check className='size-3' strokeWidth={3} />
					</div>
				}
			/>
		</button>
	);
}

export function UserGroupFeatureSummaryCard({
	feature,
	allowed,
}: {
	feature: UserGroupFeatureDefinition;
	allowed: boolean;
}) {
	const status = allowed ? 'Allowed' : 'Not allowed';

	return (
		<article
			aria-label={`${feature.label}. ${feature.description}. ${status}.`}
			className={cn(
				GRID_CARD_CLASS,
				'h-[120px] w-full text-left',
				allowed && 'border-primary bg-primary/[0.04] ring-1 ring-primary/40',
			)}
		>
			<UserGroupFeatureCardContent feature={feature} />
		</article>
	);
}

function UserGroupFeatureCardContent({ feature, status }: { feature: UserGroupFeatureDefinition; status?: ReactNode }) {
	return (
		<>
			<div className='pointer-events-none absolute inset-x-1 top-1 bottom-12 overflow-hidden rounded-md bg-sidebar/70 dark:bg-sidebar/35'>
				{feature.key === 'story-creation' ? <StoryCreationPreview /> : <AutomationCreationPreview />}
			</div>
			{status}
			<div className='absolute inset-x-0 bottom-0 flex h-12 min-w-0 flex-col justify-center px-3'>
				<span className='truncate text-xs font-medium'>{feature.label}</span>
				<span className='truncate text-[10px] text-muted-foreground'>{feature.description}</span>
			</div>
		</>
	);
}

function StoryCreationPreview() {
	return (
		<div
			data-testid='story-creation-preview'
			className='absolute left-1/2 top-1/2 h-14 w-24 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background p-2 shadow-sm'
			aria-hidden='true'
		>
			<div className='flex items-center gap-1.5'>
				<FileText className='size-3 text-primary' />
				<div className='h-1 w-8 rounded-full bg-foreground/15' />
			</div>
			<div className='mt-2 grid grid-cols-[1fr_34px] gap-2'>
				<div className='space-y-1'>
					<div className='h-1 w-full rounded-full bg-foreground/10' />
					<div className='h-1 w-4/5 rounded-full bg-foreground/10' />
					<div className='h-1 w-2/3 rounded-full bg-foreground/10' />
				</div>
				<div className='flex h-6 items-end justify-between gap-0.5 border-b border-l border-border/70 px-1'>
					<div className='h-2 w-1 rounded-t-sm bg-primary/35' />
					<div className='h-4 w-1 rounded-t-sm bg-primary/55' />
					<div className='h-3 w-1 rounded-t-sm bg-primary/75' />
					<div className='h-5 w-1 rounded-t-sm bg-primary' />
				</div>
			</div>
		</div>
	);
}

function AutomationCreationPreview() {
	return (
		<div
			data-testid='automation-creation-preview'
			className='absolute inset-0 flex items-center justify-center gap-2'
			aria-hidden='true'
		>
			<div className='flex h-10 w-14 flex-col items-center justify-center gap-1 rounded-md border bg-background shadow-sm'>
				<Clock3 className='size-3.5 text-primary' />
				<div className='h-1 w-7 rounded-full bg-foreground/10' />
			</div>
			<ArrowRight className='size-4 text-muted-foreground' />
			<div className='flex h-10 w-14 flex-col items-center justify-center gap-1 rounded-md border bg-background shadow-sm'>
				<Zap className='size-3.5 text-primary' />
				<div className='h-1 w-7 rounded-full bg-foreground/10' />
			</div>
		</div>
	);
}
