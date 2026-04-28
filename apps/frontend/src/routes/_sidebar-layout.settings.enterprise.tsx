import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, CircleX, Clock, Sparkles, TriangleAlert } from 'lucide-react';
import type { LicenseStatus } from '@nao/backend/ee-types';

import { Badge } from '@/components/ui/badge';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { requireAdminNonCloudWithLicense } from '@/lib/require-admin';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/enterprise')({
	beforeLoad: requireAdminNonCloudWithLicense,
	component: EnterprisePage,
});

const FEATURE_DESCRIPTIONS: Record<string, string> = {
	sso: 'Single sign-on via SAML or OIDC providers.',
};

function EnterprisePage() {
	const license = useQuery(trpc.license.getStatus.queryOptions());
	const status = license.data?.status;
	const hasVerifiedLicense = status === 'active' || status === 'expired';
	const details = useQuery({
		...trpc.license.getDetails.queryOptions(),
		enabled: hasVerifiedLicense,
	});

	if (license.isLoading) {
		return (
			<SettingsPageWrapper>
				<div className='text-sm text-muted-foreground'>Loading license…</div>
			</SettingsPageWrapper>
		);
	}
	if (license.isError || !license.data) {
		return (
			<SettingsPageWrapper>
				<div className='text-sm text-destructive'>Failed to load license status.</div>
			</SettingsPageWrapper>
		);
	}

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Enterprise</h1>
					<p className='text-sm text-muted-foreground'>
						Offline-verified license for nao Enterprise. Verification runs at server startup against the
						public key bundled in the build.
					</p>
				</div>

				<StatusCard status={license.data.status} />

				{hasVerifiedLicense && details.data && (
					<>
						<LicenseDetailsCard
							companyName={details.data.companyName}
							subscriptionId={details.data.subscriptionId}
							isTrial={details.data.isTrial}
							expiresAt={details.data.expiresAt}
							status={license.data.status}
						/>
						<FeaturesCard features={details.data.features} active={license.data.status === 'active'} />
					</>
				)}
			</div>
		</SettingsPageWrapper>
	);
}

function StatusCard({ status }: { status: LicenseStatus }) {
	const config = STATUS_CONFIG[status];
	const Icon = config.icon;

	return (
		<div className={cn('flex items-start gap-3 p-4 rounded-xl border', config.container)}>
			<div className={cn('shrink-0 rounded-full p-2', config.iconWrapper)}>
				<Icon className='size-4' />
			</div>
			<div className='flex flex-col gap-1 min-w-0'>
				<div className='flex items-center gap-2'>
					<span className='font-semibold text-foreground'>{config.title}</span>
					<Badge variant='ghost' className={cn('uppercase text-[10px] font-semibold', config.badge)}>
						{status}
					</Badge>
				</div>
				<p className='text-sm text-muted-foreground'>{config.description}</p>
			</div>
		</div>
	);
}

const STATUS_CONFIG: Record<
	LicenseStatus,
	{
		title: string;
		description: string;
		icon: typeof CheckCircle2;
		container: string;
		iconWrapper: string;
		badge: string;
	}
> = {
	active: {
		title: 'License active',
		description: 'Enterprise features are enabled. Verified offline against the bundled public key.',
		icon: CheckCircle2,
		container: 'border-emerald-500/30 bg-emerald-500/5',
		iconWrapper: 'bg-emerald-500/10 text-emerald-500',
		badge: 'bg-emerald-500/10 text-emerald-500',
	},
	expired: {
		title: 'License expired',
		description:
			'The license signature is valid but the expiry date has passed. Enterprise features are disabled. Contact your nao representative to renew.',
		icon: Clock,
		container: 'border-yellow-500/30 bg-yellow-500/5',
		iconWrapper: 'bg-yellow-500/10 text-yellow-500',
		badge: 'bg-yellow-500/10 text-yellow-500',
	},
	invalid: {
		title: 'License could not be verified',
		description:
			'NAO_LICENSE is set but verification failed (bad signature, malformed token, or key mismatch). See server logs for details.',
		icon: CircleX,
		container: 'border-red-500/30 bg-red-500/5',
		iconWrapper: 'bg-red-500/10 text-red-500',
		badge: 'bg-red-500/10 text-red-500',
	},
	unlicensed: {
		title: 'No license configured',
		description: 'Running in OSS mode. Set the NAO_LICENSE environment variable to activate Enterprise features.',
		icon: CircleAlert,
		container: 'border-border bg-muted/30',
		iconWrapper: 'bg-muted text-muted-foreground',
		badge: 'bg-muted text-muted-foreground',
	},
};

function LicenseDetailsCard({
	companyName,
	subscriptionId,
	isTrial,
	expiresAt,
	status,
}: {
	companyName: string;
	subscriptionId: string;
	isTrial: boolean;
	expiresAt: string | Date;
	status: LicenseStatus;
}) {
	const expiry = new Date(expiresAt);
	const now = Date.now();
	const daysLeft = Math.floor((expiry.getTime() - now) / (24 * 60 * 60 * 1000));

	return (
		<SettingsCard title='License details'>
			<DetailRow label='Company' value={companyName} />
			<DetailRow label='Subscription ID' value={<code className='font-mono text-xs'>{subscriptionId}</code>} />
			<DetailRow
				label='Plan'
				value={
					isTrial ? (
						<Badge variant='ghost' className='bg-blue-500/10 text-blue-500'>
							Trial
						</Badge>
					) : (
						<Badge variant='ghost' className='bg-primary/10 text-primary'>
							Standard
						</Badge>
					)
				}
			/>
			<DetailRow
				label='Expires'
				value={
					<div className='flex items-center gap-2'>
						<span>
							{expiry.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
						</span>
						{status === 'active' && daysLeft <= 30 && (
							<Badge variant='ghost' className='bg-yellow-500/10 text-yellow-500'>
								<TriangleAlert className='size-3' />
								{daysLeft} day{daysLeft === 1 ? '' : 's'} left
							</Badge>
						)}
						{status === 'expired' && (
							<Badge variant='ghost' className='bg-red-500/10 text-red-500'>
								Expired
							</Badge>
						)}
					</div>
				}
			/>
		</SettingsCard>
	);
}

function FeaturesCard({ features, active }: { features: string[]; active: boolean }) {
	if (features.length === 0) {
		return (
			<SettingsCard title='Features' description='Enterprise capabilities enabled by this license.'>
				<p className='text-sm text-muted-foreground'>No features granted by this license.</p>
			</SettingsCard>
		);
	}

	return (
		<SettingsCard title='Features' description='Enterprise capabilities enabled by this license.'>
			<div className='flex flex-col divide-y divide-border'>
				{features.map((feature) => (
					<div key={feature} className='flex items-start gap-3 py-3 first:pt-0 last:pb-0'>
						<div
							className={cn(
								'shrink-0 rounded-md p-1.5',
								active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
							)}
						>
							<Sparkles className='size-3.5' />
						</div>
						<div className='flex flex-col gap-0.5 min-w-0'>
							<span className='text-sm font-medium text-foreground uppercase'>{feature}</span>
							<span className='text-xs text-muted-foreground'>
								{FEATURE_DESCRIPTIONS[feature] ?? 'Enterprise feature.'}
							</span>
						</div>
					</div>
				))}
			</div>
		</SettingsCard>
	);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className='flex items-center justify-between gap-4 py-1'>
			<span className='text-sm text-muted-foreground'>{label}</span>
			<div className='text-sm text-foreground text-right'>{value}</div>
		</div>
	);
}
