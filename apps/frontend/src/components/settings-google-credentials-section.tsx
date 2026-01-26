import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Plus, XCircle } from 'lucide-react';
import { trpc } from '@/main';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface GoogleConfigSectionProps {
	isAdmin: boolean;
}

export function GoogleConfigSection({ isAdmin }: GoogleConfigSectionProps) {
	const queryClient = useQueryClient();
	const googleSettings = useQuery(trpc.google.getGoogleSettings.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	const [clientId, setClientId] = useState('');
	const [clientSecret, setClientSecret] = useState('');
	const [authDomains, setAuthDomains] = useState('');
	const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

	const hasEnvConfig = !!(googleSettings.data?.clientId || googleSettings.data?.clientSecret);

	const updateGoogleSettings = useMutation(
		trpc.google.updateGoogleSettings.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.google.getGoogleSettings.queryOptions());
				setIsEditing(false);
				setClientId('');
				setClientSecret('');
				setAuthDomains('');
				setTestResult(null);
			},
		}),
	);

	const handleSave = async () => {
		await updateGoogleSettings.mutateAsync({
			clientId,
			clientSecret,
			authDomains,
		});
	};

	const handleCancel = () => {
		setIsEditing(false);
		setClientId('');
		setClientSecret('');
		setAuthDomains('');
		setTestResult(null);
	};

	const maskCredential = (value: string) => {
		if (!value) {
			return '';
		}
		if (value.length <= 8) {
			return '••••••••';
		}
		return `${value.slice(0, 4)}••••${value.slice(-4)}`;
	};

	return (
		<div className='grid gap-4'>
			{hasEnvConfig && !isEditing && (
				<button
					type='button'
					className='w-full text-left cursor-pointer'
					onClick={() => isAdmin && setIsEditing(true)}
				>
					<div className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors'>
						<div className='flex-1 grid gap-1'>
							<div className='flex items-center gap-2'>
								<span className='text-sm font-medium text-foreground'>Google OAuth</span>
								{isAdmin && <span className='text-xs text-muted-foreground'>(Override Env)</span>}
							</div>
							<div className='grid gap-0.5'>
								<span className='text-xs font-mono text-muted-foreground'>
									Client ID: {maskCredential(googleSettings.data?.clientId || '')}
								</span>
								{googleSettings.data?.authDomains && (
									<span className='text-xs text-muted-foreground'>
										Domains: {googleSettings.data.authDomains}
									</span>
								)}
							</div>
						</div>
						<span className='px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground'>
							ENV
						</span>
					</div>
				</button>
			)}

			{isAdmin && isEditing && (
				<div className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'>
					<div className='grid gap-4'>
						<div className='grid gap-2'>
							<label htmlFor='google-client-id' className='text-sm font-medium text-foreground'>
								Google Client ID
							</label>
							<Input
								id='google-client-id'
								type='text'
								value={clientId}
								onChange={(e) => setClientId(e.target.value)}
								placeholder='Your Google Client ID'
							/>
						</div>
						<div className='grid gap-2'>
							<label htmlFor='google-client-secret' className='text-sm font-medium text-foreground'>
								Google Client Secret
							</label>
							<Input
								id='google-client-secret'
								type='password'
								value={clientSecret}
								onChange={(e) => setClientSecret(e.target.value)}
								placeholder='Your Google Client Secret'
							/>
						</div>
						<div className='grid gap-2'>
							<label htmlFor='google-auth-domains' className='text-sm font-medium text-foreground'>
								Google Auth Domains
							</label>
							<Input
								id='google-auth-domains'
								type='text'
								value={authDomains}
								onChange={(e) => setAuthDomains(e.target.value)}
								placeholder='Comma-separated domains (e.g., example.com, test.com)'
							/>
						</div>
					</div>

					{testResult && (
						<div
							className={`flex items-center gap-2 p-3 rounded-md ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
						>
							{testResult.success ? <CheckCircle className='size-4' /> : <XCircle className='size-4' />}
							<span className='text-sm'>
								{testResult.success ? testResult.message : testResult.error}
							</span>
						</div>
					)}

					<div className='flex justify-end gap-2'>
						{isEditing && (
							<Button variant='ghost' size='sm' onClick={handleCancel}>
								Cancel
							</Button>
						)}
						<Button size='sm' onClick={handleSave} disabled={updateGoogleSettings.isPending}>
							<Plus className='size-4 mr-1' />
							{isEditing ? 'Update' : 'Add'}
						</Button>
					</div>
				</div>
			)}

			{!hasEnvConfig && !isAdmin && (
				<p className='text-sm text-muted-foreground'>
					No Google OAuth configured. Contact an admin to set it up.
				</p>
			)}
		</div>
	);
}
