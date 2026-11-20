import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { FormError, PasswordField, TextField } from '@/components/ui/form-fields';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

/** Shown once nao has activated SSO for the organization: the admin connects their own Okta (or any OIDC IdP). */
export function OrgSsoSettings() {
	const sso = useQuery(trpc.organization.getSso.queryOptions());
	if (!sso.data) {
		return null;
	}

	const isConnected = !!sso.data.issuer;
	return (
		<SettingsCard
			title='Single sign-on (Okta)'
			description='Members with one of these email domains sign in through your identity provider and join this organization.'
			action={
				<Badge variant={isConnected ? 'success' : 'outline'}>
					{isConnected ? 'Connected' : 'Not connected'}
				</Badge>
			}
		>
			<div className='flex flex-col gap-4'>
				<div className='flex flex-wrap gap-2'>
					{sso.data.domains.map((domain) => (
						<Badge key={domain} variant='outline'>
							{domain}
						</Badge>
					))}
				</div>
				<CopyableUrl label='Sign-in redirect URI to add to your Okta app' url={sso.data.redirectUri} />
				{!sso.data.ssoLicensed && (
					<p className='text-sm text-muted-foreground'>
						Sign-in through your identity provider starts once your license includes SSO.
					</p>
				)}
				<OrgSsoForm
					key={sso.data.updatedAt.toString()}
					issuer={sso.data.issuer ?? ''}
					clientId={sso.data.clientId ?? ''}
					hasClientSecret={sso.data.hasClientSecret}
					additionalScopes={sso.data.additionalScopes}
				/>
			</div>
		</SettingsCard>
	);
}

function OrgSsoForm({
	issuer,
	clientId,
	hasClientSecret,
	additionalScopes,
}: {
	issuer: string;
	clientId: string;
	hasClientSecret: boolean;
	additionalScopes: string[];
}) {
	const queryClient = useQueryClient();
	const configure = useMutation(
		trpc.organization.configureSso.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.organization.getSso.queryKey() }),
		}),
	);
	const form = useForm({
		defaultValues: { issuer, clientId, clientSecret: '', additionalScopes: additionalScopes.join(' ') },
		onSubmit: async ({ value }) => {
			await configure.mutateAsync({
				...value,
				clientSecret: value.clientSecret || undefined,
				additionalScopes: value.additionalScopes.split(/[\s,]+/).filter(Boolean),
			});
		},
	});

	return (
		<form
			className='flex flex-col gap-3'
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<TextField form={form} name='issuer' label='Issuer URL' placeholder='https://acme.okta.com' required />
			<TextField form={form} name='clientId' label='Client ID' placeholder='0oa1b2c3d4e5f6g7h8i9' required />
			<PasswordField
				form={form}
				name='clientSecret'
				label='Client secret'
				hint={hasClientSecret ? '(leave empty to keep current)' : undefined}
				required={!hasClientSecret}
			/>
			<TextField
				form={form}
				name='additionalScopes'
				label='Additional scopes'
				placeholder='offline_access session:role-any'
			/>
			{configure.error && <FormError error={configure.error.message} />}
			<div className='flex justify-end'>
				<Button type='submit' isLoading={configure.isPending}>
					{issuer ? 'Save' : 'Connect'}
				</Button>
			</div>
		</form>
	);
}
