import { useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { cn } from '@/lib/utils';

interface ImportProviderCardProps {
	providerLabel: string;
	icon: ComponentType<{ className?: string }>;
	connectHref: string;
	connectTarget?: string;
	resourceNounSingular: string;
	resourceNounPlural: string;
	connected: boolean;
	compact?: boolean;
	className?: string;
	pickerDialogStyle?: CSSProperties;
	Picker: ComponentType<{
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onImported?: (project: ImportedProject) => void;
		dialogStyle?: CSSProperties;
	}>;
	onImported?: (project: ImportedProject) => void;
}

export type ImportedProject = {
	projectId: string;
	projectName: string;
	status: 'created' | 'updated';
};

/**
 * Card for importing a project from a git provider (GitHub, GitLab, ...), including the
 * repo/project picker dialog. Kept provider-agnostic so this flow can't drift between providers.
 */
export function ImportProviderCard({
	providerLabel,
	icon: Icon,
	connectHref,
	connectTarget,
	resourceNounSingular,
	resourceNounPlural,
	connected,
	compact = false,
	className,
	pickerDialogStyle,
	Picker,
	onImported,
}: ImportProviderCardProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const picker = (
		<Picker
			open={pickerOpen}
			onOpenChange={setPickerOpen}
			onImported={onImported}
			dialogStyle={pickerDialogStyle}
		/>
	);

	if (compact) {
		return (
			<>
				<div
					className={cn(
						'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center',
						className,
					)}
				>
					<div className='flex min-w-0 flex-1 items-center gap-3'>
						<div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet/10 text-violet'>
							<Icon className='size-4' />
						</div>
						<div className='min-w-0'>
							<p className='font-medium text-foreground'>
								{connected ? `Choose a ${resourceNounSingular}` : 'Add an existing project'}
							</p>
							<p className='text-xs text-muted-foreground'>
								{connected
									? 'Import it as your nao project.'
									: `Connect ${providerLabel} and choose a ${resourceNounSingular}.`}
							</p>
						</div>
					</div>
					{connected ? (
						<Button size='sm' onClick={() => setPickerOpen(true)}>
							Browse
						</Button>
					) : (
						<Button size='sm' asChild>
							<a href={connectHref} target={connectTarget}>
								Connect
							</a>
						</Button>
					)}
				</div>
				{picker}
			</>
		);
	}

	return (
		<>
			<SettingsCard
				title={`Import from ${providerLabel}`}
				description={
					connected
						? `Select a ${resourceNounSingular} to import as a nao project.`
						: `Connect your ${providerLabel} account to browse and import ${resourceNounPlural}.`
				}
				icon={<Icon className='size-4' />}
				className={className}
			>
				{connected ? (
					<div className='flex items-center justify-between'>
						<p className='text-sm text-muted-foreground'>
							Browse your {resourceNounPlural} and import one as a project.
						</p>
						<Button variant='secondary' size='sm' onClick={() => setPickerOpen(true)}>
							<Icon className='size-3.5' />
							Browse {resourceNounPlural}
						</Button>
					</div>
				) : (
					<div className='flex items-center justify-between'>
						<p className='text-sm text-muted-foreground'>{providerLabel} is not connected yet.</p>
						<Button variant='secondary' size='sm' asChild>
							<a href={connectHref} target={connectTarget}>
								<Icon className='size-3.5' />
								Connect {providerLabel}
							</a>
						</Button>
					</div>
				)}
			</SettingsCard>
			{picker}
		</>
	);
}
