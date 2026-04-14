import { Pencil } from 'lucide-react';
import { SmtpForm } from './smtp-form';
import { Button } from '@/components/ui/button';
import { useSmtpSettings } from '@/hooks/use-smtp-settings';

interface SmtpConfigSectionProps {
	isAdmin: boolean;
}

export function SmtpConfigSection({ isAdmin }: SmtpConfigSectionProps) {
	if (!isAdmin) {
		return <p className='text-sm text-muted-foreground'>Contact your admin to update SMTP settings.</p>;
	}

	return <SmtpConfigAdmin />;
}

function SmtpConfigAdmin() {
	const {
		settings,
		usingDbOverride,
		editingState,
		updatePending,
		updateError,
		handleSubmit,
		handleCancel,
		handleEdit,
	} = useSmtpSettings();

	if (editingState?.isEditing) {
		return (
			<SmtpForm
				hasExistingConfig={!!settings?.host}
				initialValues={
					settings
						? { host: settings.host, port: settings.port, ssl: settings.ssl, mailFrom: settings.mailFrom }
						: undefined
				}
				onSubmit={handleSubmit}
				onCancel={handleCancel}
				isPending={updatePending}
				error={updateError}
			/>
		);
	}

	if (!settings?.host) {
		return (
			<div className='flex flex-col items-center gap-3 py-4'>
				<p className='text-sm text-muted-foreground'>No SMTP server configured. Email features are disabled.</p>
				<Button variant='outline' size='sm' onClick={handleEdit}>
					Configure SMTP
				</Button>
			</div>
		);
	}

	const badge = usingDbOverride ? 'DB' : 'ENV';

	return (
		<div className='p-4 rounded-lg border border-border bg-muted/30'>
			<div className='flex items-center gap-4'>
				<div className='flex-1 grid gap-1'>
					<div className='flex items-center gap-2'>
						<span className='text-sm font-medium text-foreground'>SMTP</span>
						<span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground'>
							{badge}
						</span>
					</div>
					<div className='grid gap-0.5'>
						<span className='text-xs font-mono text-muted-foreground'>Host: {settings.host}</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Port: {settings.port || '587'} | SSL: {settings.ssl || 'false'}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>From: {settings.mailFrom}</span>
					</div>
				</div>
				<Button variant='ghost' size='icon-sm' onClick={handleEdit}>
					<Pencil className='size-3 text-muted-foreground' />
				</Button>
			</div>
		</div>
	);
}
