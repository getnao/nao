/* @license Enterprise */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
	Boxes,
	Check,
	CheckCircle2,
	CircleAlert,
	CircleDollarSign,
	CircleX,
	Clock,
	Columns3,
	FileCheck,
	KeyRound,
	LifeBuoy,
	Palette,
	ShieldCheck,
	TriangleAlert,
	UserCheck,
} from 'lucide-react';
import type { LicenseStatus } from '@nao/backend/license-types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { useLicenseFeatures } from '@/hooks/use-license';
import { requireNonViewerNonCloud } from '@/lib/require-admin';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/enterprise')({
	beforeLoad: requireNonViewerNonCloud,
	staticData: {
		title: 'Enterprise',
	},
	component: EnterprisePage,
});

function EnterprisePage() {
	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Enterprise</h1>
					<p className='text-sm text-muted-foreground'>
						Advanced capabilities for teams running nao across a company.
					</p>
				</div>
				<div className='flex flex-col gap-12'>
					<LicenseSettings />
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

function LicenseSettings() {
	const license = useQuery(trpc.license.getStatus.queryOptions());
	const status = license.data?.status;
	const hasVerifiedLicense = status === 'active' || status === 'expired';
	const details = useQuery({
		...trpc.license.getDetails.queryOptions(),
		enabled: hasVerifiedLicense,
	});

	if (license.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading license…</div>;
	}
	if (license.isError || !license.data) {
		return <div className='text-sm text-destructive'>Failed to load license status.</div>;
	}

	return (
		<div className='flex flex-col gap-12'>
			<SettingsCard title='Setup'>
				<StatusCard status={license.data.status} />
				{license.data.status === 'unlicensed' && (
					<p className='text-xs text-muted-foreground'>
						Set a license key with the <code className='font-mono'>NAO_LICENSE</code> environment variable
						on the server. It takes effect after the server restarts.
					</p>
				)}
				{hasVerifiedLicense && details.data && (
					<LicenseDetails
						companyName={details.data.companyName}
						subscriptionId={details.data.subscriptionId}
						isOffline={details.data.isOffline}
						expiresAt={details.data.expiresAt}
						status={license.data.status}
					/>
				)}
			</SettingsCard>
			<WhatsIncludedCard isLicenseActive={license.data.status === 'active'} />

			{license.data.status !== 'active' && (
				<div>
					<Button asChild>
						<a href='https://getnao.io/pricing/' target='_blank' rel='noreferrer'>
							Upgrade to Enterprise
						</a>
					</Button>
				</div>
			)}
		</div>
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
		description: "You're on the free self-hosted plan. The features below are locked.",
		icon: CircleAlert,
		container: 'border-border bg-muted/30',
		iconWrapper: 'bg-muted text-muted-foreground',
		badge: 'bg-muted text-muted-foreground',
	},
};

function LicenseDetails({
	companyName,
	subscriptionId,
	isOffline,
	expiresAt,
	status,
}: {
	companyName: string;
	subscriptionId: string;
	isOffline: boolean;
	expiresAt: string | Date;
	status: LicenseStatus;
}) {
	const expiry = new Date(expiresAt);
	const now = Date.now();
	const daysLeft = Math.floor((expiry.getTime() - now) / (24 * 60 * 60 * 1000));

	return (
		<>
			<DetailRow label='Company' value={companyName} />
			<DetailRow label='Subscription ID' value={<code className='font-mono text-xs'>{subscriptionId}</code>} />
			<DetailRow
				label='Mode'
				value={
					<Badge variant='ghost' className={isOffline ? 'bg-violet/10 text-violet' : 'bg-muted'}>
						{isOffline ? 'Offline' : 'Online'}
					</Badge>
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
		</>
	);
}

const ENTERPRISE_FEATURES = [
	{
		key: 'sso',
		label: 'Company sign-in (SSO)',
		description:
			'Let people sign in with their existing work account, with roles managed by your identity provider.',
		icon: KeyRound,
	},
	{
		key: 'white-label',
		label: 'Company-branded UI',
		description: 'Replace the nao name, logos and colors with your own.',
		icon: Palette,
	},
	{
		key: 'user-budget',
		label: 'Spend limits per user',
		description: 'Cap how much each person can spend on the AI models.',
		icon: CircleDollarSign,
	},
	{
		key: 'multi-project',
		label: 'Multiple projects',
		description: 'Keep separate data contexts for different teams and use cases.',
		icon: Boxes,
	},
	{
		key: 'exclude-columns',
		label: 'Excluded columns',
		description: 'Block the agent from querying columns marked as excluded.',
		icon: Columns3,
	},
	{
		label: 'Row-level security',
		description: "Restrict which rows each person can see, using your warehouse's own rules.",
		icon: ShieldCheck,
	},
	{
		label: 'Data rights impersonation from warehouse',
		description: 'Queries run as the signed-in user, so their existing warehouse permissions apply.',
		icon: UserCheck,
	},
	{
		label: 'SOC 2 Type II reports',
		description: 'Audited security reports for your compliance review.',
		icon: FileCheck,
	},
	{
		label: 'Priority support',
		description: 'A direct line to the nao team, plus input on the roadmap.',
		icon: LifeBuoy,
	},
] as const;

function WhatsIncludedCard({ isLicenseActive }: { isLicenseActive: boolean }) {
	const features = useLicenseFeatures();

	return (
		<SettingsCard title='What’s included'>
			<div className='grid gap-4 sm:grid-cols-2'>
				{ENTERPRISE_FEATURES.map((feature) => {
					const Icon = feature.icon;
					const isIncluded = !('key' in feature) || features.data?.[feature.key] === true;
					const canShowMarker = !('key' in feature) || features.isSuccess;

					return (
						<div
							key={feature.label}
							className='flex items-start gap-3 rounded-lg border border-border bg-background p-4'
						>
							<div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
								<Icon className='size-4' />
							</div>
							<div className='flex min-w-0 flex-1 flex-col gap-1'>
								<div className='flex items-start justify-between gap-2'>
									<span className='text-sm font-medium'>{feature.label}</span>
									{isLicenseActive && canShowMarker && <FeatureMarker isIncluded={isIncluded} />}
								</div>
								<span className='text-xs text-muted-foreground'>{feature.description}</span>
							</div>
						</div>
					);
				})}
			</div>
		</SettingsCard>
	);
}

function FeatureMarker({ isIncluded }: { isIncluded: boolean }) {
	if (isIncluded) {
		return (
			<span className='flex shrink-0 items-center gap-1 text-xs text-emerald-500'>
				<Check className='size-3' />
				Included
			</span>
		);
	}

	return <span className='shrink-0 text-xs text-muted-foreground'>Not in your plan</span>;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className='flex items-center justify-between gap-4 py-1'>
			<span className='text-sm text-muted-foreground'>{label}</span>
			<div className='text-sm text-foreground text-right'>{value}</div>
		</div>
	);
}
