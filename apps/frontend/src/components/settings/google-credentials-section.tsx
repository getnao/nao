import { Pencil } from 'lucide-react';
import { GoogleForm } from './google-form';
import { Button } from '@/components/ui/button';
import { useGoogleSettings } from '@/hooks/use-google-settings';

interface GoogleConfigSectionProps {
	isAdmin: boolean;
}

export function GoogleConfigSection({ isAdmin }: GoogleConfigSectionProps) {
	const {
		settings,
		usingDbOverride,
		editingState,
		updatePending,
		updateError,
		handleSubmit,
		handleCancel,
		handleEdit,
	} = useGoogleSettings();

	const maskCredential = (value: string) => {
		if (!value) {
			return '';
		}
		if (value.length <= 8) {
			return '••••••••';
		}
		return `${value.slice(0, 4)}••••${value.slice(-4)}`;
	};

	if (!isAdmin) {
		return <p className='text-sm text-muted-foreground'>Contact your admin to update Google OAuth settings.</p>;
	}

	if (editingState?.isEditing) {
		return (
			<GoogleForm
				hasExistingCredentials={!!settings?.clientId}
				initialAuthDomains={settings?.authDomains ?? ''}
				onSubmit={handleSubmit}
				onCancel={handleCancel}
				isPending={updatePending}
				error={updateError}
			/>
		);
	}

	const badge = usingDbOverride ? 'DB' : 'ENV';

	return (
		<div className='p-4 rounded-lg border border-border bg-muted/30'>
			<div className='flex items-center gap-4'>
				<div className='flex-1 grid gap-1'>
					<div className='flex items-center gap-2'>
						<span className='text-sm font-medium text-foreground'>Google OAuth</span>
						<span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground'>
							{badge}
						</span>
					</div>
					<div className='grid gap-0.5'>
						<span className='text-xs font-mono text-muted-foreground'>
							Client ID: {maskCredential(settings?.clientId || '')}
						</span>
						{settings?.authDomains && (
							<span className='text-xs text-muted-foreground'>Domains: {settings.authDomains}</span>
						)}
					</div>
				</div>
				{isAdmin && (
					<Button variant='ghost' size='icon-sm' onClick={handleEdit}>
						<Pencil className='size-3 text-muted-foreground' />
					</Button>
				)}
			</div>
		</div>
	);
}
