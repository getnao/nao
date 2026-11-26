import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { trpc } from '@/main';

export function OrgTwoFactorSettings({ isAdmin }: { isAdmin: boolean }) {
	const queryClient = useQueryClient();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const { data: policy } = useQuery(trpc.organization.getTwoFactorPolicy.queryOptions());
	const updatePolicy = useMutation(
		trpc.organization.updateTwoFactorPolicy.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.organization.getTwoFactorPolicy.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.account.getTwoFactorStatus.queryKey() });
			},
		}),
	);

	if (config.data?.enableUserLogin === false || !policy) {
		return null;
	}

	const { required, emailCodes, emailAvailable } = policy;
	const isDisabled = !isAdmin || updatePolicy.isPending;

	return (
		<SettingsCard
			title='Two-factor authentication'
			description='Applies to members who log in with email and password. SSO members rely on their identity provider.'
			divide
		>
			<SettingsToggleRow
				id='two-factor-required'
				label='Require for all members'
				description='Members without it must set it up before they can keep using the app.'
				checked={required}
				onCheckedChange={(checked) => {
					updatePolicy.mutate({ required: checked, emailCodes });
				}}
				disabled={isDisabled}
			/>
			<SettingsToggleRow
				id='two-factor-email-codes'
				label='Allow email codes'
				description={
					emailAvailable
						? 'Members can receive their code by email instead of using an authenticator app.'
						: 'Requires an email provider (SMTP) to be configured.'
				}
				checked={emailCodes && emailAvailable}
				onCheckedChange={(checked) => {
					updatePolicy.mutate({ required, emailCodes: checked });
				}}
				disabled={isDisabled || !emailAvailable}
			/>
			{updatePolicy.error && <p className='py-2 text-xs text-destructive'>{updatePolicy.error.message}</p>}
		</SettingsCard>
	);
}
