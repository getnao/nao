import { useQuery } from '@tanstack/react-query';

import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Badge } from '@/components/ui/badge';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

const SSO_OPTIONS = [
	{
		label: 'OIDC provider',
		description: 'Okta, Auth0, Keycloak, OneLogin and more, including sign-in from provider app tiles.',
	},
	{
		label: 'Microsoft Entra ID',
		description: 'Let users sign in with their Microsoft work account.',
	},
	{
		label: 'Roles managed by your identity provider',
		description: 'Assign nao roles from groups in your identity provider.',
	},
] as const;

export function SsoSettingsSection() {
	const features = useLicenseFeatures();
	const isSsoEnabled = features.data?.sso === true;
	const oidcConfig = useQuery({
		...trpc.authConfig.oidc.getConfig.queryOptions(),
		enabled: isSsoEnabled,
	});
	const microsoftSetup = useQuery({
		...trpc.authConfig.microsoft.isSetup.queryOptions(),
		enabled: isSsoEnabled,
	});

	return (
		<SettingsCard
			title='Company sign-in (SSO)'
			description='Let people sign in with their existing work account. Configured with environment variables on the server.'
			action={!isSsoEnabled ? <UpgradeToEnterprise /> : undefined}
		>
			<LockedFieldset disabled={!isSsoEnabled}>
				{isSsoEnabled ? (
					<>
						<SettingsControlRow
							label={SSO_OPTIONS[0].label}
							description={SSO_OPTIONS[0].description}
							control={
								oidcConfig.data ? (
									<div className='flex items-center gap-2'>
										<span className='text-sm text-foreground'>{oidcConfig.data.providerName}</span>
										<Badge variant='success'>Active</Badge>
									</div>
								) : (
									<QueryStatusBadge
										isLoading={oidcConfig.isLoading}
										isError={oidcConfig.isError}
										inactiveLabel='Not configured'
									/>
								)
							}
						/>
						<SettingsControlRow
							label={SSO_OPTIONS[1].label}
							description={SSO_OPTIONS[1].description}
							control={
								<QueryStatusBadge
									active={microsoftSetup.data === true}
									isLoading={microsoftSetup.isLoading}
									isError={microsoftSetup.isError}
									inactiveLabel='Not configured'
								/>
							}
						/>
						<SettingsControlRow
							label={SSO_OPTIONS[2].label}
							description={SSO_OPTIONS[2].description}
							control={
								<QueryStatusBadge
									active={oidcConfig.data?.rolesManagedByIdp === true}
									isLoading={oidcConfig.isLoading}
									isError={oidcConfig.isError}
									inactiveLabel={oidcConfig.data ? 'Not enabled' : 'Not configured'}
								/>
							}
						/>
					</>
				) : (
					SSO_OPTIONS.map((option) => (
						<SettingsControlRow
							key={option.label}
							label={option.label}
							description={option.description}
							control={null}
						/>
					))
				)}
			</LockedFieldset>
		</SettingsCard>
	);
}

function QueryStatusBadge({
	active = false,
	isLoading,
	isError,
	inactiveLabel,
}: {
	active?: boolean;
	isLoading: boolean;
	isError: boolean;
	inactiveLabel: string;
}) {
	if (isLoading) {
		return <Badge variant='secondary'>Checking…</Badge>;
	}

	if (isError) {
		return <Badge variant='secondary'>Unavailable</Badge>;
	}

	return <Badge variant={active ? 'success' : 'secondary'}>{active ? 'Active' : inactiveLabel}</Badge>;
}
