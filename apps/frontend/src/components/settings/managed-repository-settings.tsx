import { Link } from '@tanstack/react-router';
import { GitBranch } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';

export function ManagedRepositorySettings() {
	return (
		<SettingsCard
			title='Managed by nao'
			icon={<GitBranch className='size-4' />}
			description='Your context files are stored and versioned by nao. Every change you save in the File Explorer is published automatically.'
			action={
				<Button size='sm' variant='primary-gradient' asChild>
					<Link to='/settings/context-explorer'>Open File Explorer</Link>
				</Button>
			}
			className='gap-6 p-6'
		>
			<p className='text-sm text-muted-foreground'>
				Connecting your own GitHub or GitLab repository is coming soon.
			</p>
		</SettingsCard>
	);
}
