import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { TWO_FACTOR_METHOD_LABELS } from './two-factor-types';
import type { TwoFactorMethod } from './two-factor-types';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { trpc } from '@/main';

interface OrgTwoFactorMethodsProps {
	isAdmin: boolean;
}

export function OrgTwoFactorMethods({ isAdmin }: OrgTwoFactorMethodsProps) {
	const queryClient = useQueryClient();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const settings = useQuery(trpc.organization.getTwoFactorSettings.queryOptions());
	const updateMethods = useMutation(trpc.organization.updateTwoFactorMethods.mutationOptions());

	if (config.data?.enableUserLogin === false || !settings.data) {
		return null;
	}

	const { emailAvailable } = settings.data;
	const methods = settings.data.methods.filter((method) => emailAvailable || method !== 'email');

	const toggle = (method: TwoFactorMethod, allowed: boolean) => {
		const nextMethods = allowed ? [...methods, method] : methods.filter((current) => current !== method);
		updateMethods.mutate(
			{ methods: nextMethods },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: trpc.organization.getTwoFactorSettings.queryKey() });
					queryClient.invalidateQueries({ queryKey: trpc.twoFactor.getStatus.queryKey() });
				},
			},
		);
	};

	return (
		<SettingsCard
			title='Two-factor authentication'
			description='Choose which methods members who log in with email and password can use as a second step. Members set it up from their account settings.'
			divide
		>
			<SettingsToggleRow
				id='two-factor-totp'
				label={TWO_FACTOR_METHOD_LABELS.totp}
				description='Codes from Google Authenticator, 1Password or any TOTP app.'
				checked={methods.includes('totp')}
				onCheckedChange={(checked) => toggle('totp', checked)}
				disabled={!isAdmin || updateMethods.isPending}
			/>
			<SettingsToggleRow
				id='two-factor-email'
				label={TWO_FACTOR_METHOD_LABELS.email}
				description={
					emailAvailable
						? 'A one-time code sent to the member’s email address.'
						: 'Requires an email provider (SMTP) to be configured.'
				}
				checked={methods.includes('email')}
				onCheckedChange={(checked) => toggle('email', checked)}
				disabled={!isAdmin || !emailAvailable || updateMethods.isPending}
			/>
			{updateMethods.error && <p className='py-2 text-xs text-destructive'>{updateMethods.error.message}</p>}
		</SettingsCard>
	);
}
