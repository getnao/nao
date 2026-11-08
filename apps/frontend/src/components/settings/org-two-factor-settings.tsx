import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { TWO_FACTOR_METHOD_LABELS } from './two-factor-types';
import type { TwoFactorMethod } from './two-factor-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow, SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { trpc } from '@/main';

const GRACE_PERIOD_DAY_OPTIONS = [0, 1, 3, 7, 14, 30];

interface OrgTwoFactorSettingsProps {
	isAdmin: boolean;
}

export function OrgTwoFactorSettings({ isAdmin }: OrgTwoFactorSettingsProps) {
	const queryClient = useQueryClient();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const settings = useQuery(trpc.organization.getTwoFactorSettings.queryOptions());
	const updateMethods = useMutation(trpc.organization.updateTwoFactorMethods.mutationOptions());
	const updateRequirement = useMutation(trpc.organization.updateTwoFactorRequirement.mutationOptions());

	if (config.data?.enableUserLogin === false || !settings.data) {
		return null;
	}

	const { emailAvailable, methods: storedMethods, required, gracePeriodDays } = settings.data;
	const methods = storedMethods.filter((method) => emailAvailable || method !== 'email');
	const isPending = updateMethods.isPending || updateRequirement.isPending;
	const error = updateMethods.error ?? updateRequirement.error;

	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: trpc.organization.getTwoFactorSettings.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.organization.getMembers.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.twoFactor.getStatus.queryKey() });
	};

	const toggleMethod = (method: TwoFactorMethod, allowed: boolean) => {
		const nextMethods = allowed
			? [...storedMethods, method]
			: storedMethods.filter((current) => current !== method);
		updateMethods.mutate({ methods: nextMethods }, { onSuccess: refresh });
	};

	const saveRequirement = (requirement: { required: boolean; gracePeriodDays: number }) => {
		updateRequirement.mutate(requirement, { onSuccess: refresh });
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
				onCheckedChange={(checked) => toggleMethod('totp', checked)}
				disabled={!isAdmin || isPending}
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
				onCheckedChange={(checked) => toggleMethod('email', checked)}
				disabled={!isAdmin || !emailAvailable || isPending}
			/>
			<SettingsToggleRow
				id='two-factor-required'
				label='Require for all members'
				description='Members who log in with email and password must set it up before their grace period ends. SSO members are not affected.'
				checked={required}
				onCheckedChange={(checked) => saveRequirement({ required: checked, gracePeriodDays })}
				disabled={!isAdmin || (!required && !methods.length) || isPending}
			/>
			{required && (
				<SettingsControlRow
					label='Grace period'
					description='Time members have to set it up, counted from when it became required or when they joined. You can restart it for a member from the members list.'
					control={
						<GracePeriodSelect
							value={gracePeriodDays}
							disabled={!isAdmin || isPending}
							onChange={(days) => saveRequirement({ required, gracePeriodDays: days })}
						/>
					}
				/>
			)}
			{error && <p className='py-2 text-xs text-destructive'>{error.message}</p>}
		</SettingsCard>
	);
}

interface GracePeriodSelectProps {
	value: number;
	disabled: boolean;
	onChange: (days: number) => void;
}

function GracePeriodSelect({ value, disabled, onChange }: GracePeriodSelectProps) {
	const options = GRACE_PERIOD_DAY_OPTIONS.includes(value)
		? GRACE_PERIOD_DAY_OPTIONS
		: [...GRACE_PERIOD_DAY_OPTIONS, value].sort((a, b) => a - b);
	return (
		<Select value={String(value)} onValueChange={(days) => onChange(Number(days))} disabled={disabled}>
			<SelectTrigger className='w-36 font-normal' aria-label='Grace period'>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((days) => (
					<SelectItem key={days} value={String(days)}>
						{formatGracePeriod(days)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function formatGracePeriod(days: number): string {
	if (days === 0) {
		return 'None';
	}
	return days === 1 ? '1 day' : `${days} days`;
}
