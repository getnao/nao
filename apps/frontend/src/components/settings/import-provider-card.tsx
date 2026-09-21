import { useState } from 'react';
import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';

interface ImportProviderCardProps {
	providerLabel: string;
	icon: ComponentType<{ className?: string }>;
	connectHref: string;
	resourceNounSingular: string;
	resourceNounPlural: string;
	connected: boolean;
	Picker: ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>;
}

/**
 * Card for importing a project from a git provider (GitHub, GitLab, ...), including the
 * repo/project picker dialog. Kept provider-agnostic so this flow can't drift between providers.
 */
export function ImportProviderCard({
	providerLabel,
	icon: Icon,
	connectHref,
	resourceNounSingular,
	resourceNounPlural,
	connected,
	Picker,
}: ImportProviderCardProps) {
	const [pickerOpen, setPickerOpen] = useState(false);

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
							<a href={connectHref}>
								<Icon className='size-3.5' />
								Connect {providerLabel}
							</a>
						</Button>
					</div>
				)}
			</SettingsCard>
			<Picker open={pickerOpen} onOpenChange={setPickerOpen} />
		</>
	);
}
