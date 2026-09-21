import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { requireCloudBilling } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/organization/billing')({
	beforeLoad: requireCloudBilling,
	staticData: {
		title: 'Plan & Billing',
	},
	component: PlanAndBillingPage,
});

function PlanAndBillingPage() {
	const billing = useQuery(trpc.billing.getStatus.queryOptions());
	const plan = billing.data?.plan;

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Plan & Billing</h1>
					<p className='text-sm text-muted-foreground'>Review the plan available to your organization.</p>
				</div>

				<div className='flex flex-col gap-12'>
					<SettingsCard title={plan?.name ?? 'Plan'}>
						{billing.isLoading && <p className='text-sm text-muted-foreground'>Loading billing details…</p>}
						{billing.isError && <p className='text-sm text-destructive'>Unable to load billing details.</p>}
						{billing.data && !plan && (
							<p className='text-sm text-muted-foreground'>
								{billing.data.planKey
									? 'Plan details are unavailable.'
									: 'No billing plan is assigned to this organization.'}
							</p>
						)}
						{plan && (
							<div className='flex flex-col gap-5'>
								<div>
									<div className='text-2xl font-semibold text-foreground'>
										{formatPrice(plan.amount, plan.currency)}
									</div>
									<div className='text-sm text-muted-foreground'>
										per {formatInterval(plan.interval, plan.intervalCount)}
									</div>
								</div>

								<dl className='grid gap-3 text-sm sm:grid-cols-2'>
									<PlanDetail
										label='Users'
										value={plan.userLimit === null ? 'Unlimited' : String(plan.userLimit)}
									/>
									<PlanDetail
										label='Billing period'
										value={`Every ${formatInterval(plan.interval, plan.intervalCount)}`}
									/>
									<PlanDetail label='Trial' value={`${plan.trialDays} days for new organizations`} />
									<PlanDetail label='Currency' value={plan.currency.toUpperCase()} />
								</dl>
							</div>
						)}
					</SettingsCard>

					{billing.data && (
						<SettingsCard title='Subscription'>
							<dl className='grid gap-3 text-sm sm:grid-cols-2'>
								<PlanDetail label='Status' value={formatStatus(billing.data.status)} />
								<PlanDetail label='Trial ends' value={formatDate(billing.data.trialEndsAt)} />
								<PlanDetail
									label='Current period ends'
									value={formatDate(billing.data.currentPeriodEndsAt)}
								/>
								<PlanDetail
									label='Access through'
									value={formatDate(billing.data.billingAccessEndsAt)}
								/>
							</dl>
						</SettingsCard>
					)}

					<SettingsCard title='Billing management'>
						<p className='text-sm text-muted-foreground'>
							Payment details, invoices, and cancellation will be available here when self-serve billing
							is enabled.
						</p>
						{billing.data && !billing.data.canManageBilling && (
							<p className='text-sm text-muted-foreground'>
								Only an organization admin can manage billing.
							</p>
						)}
					</SettingsCard>
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

function formatPrice(amount: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: currency.toUpperCase(),
		maximumFractionDigits: 0,
	}).format(amount / 100);
}

function formatInterval(interval: string, intervalCount: number): string {
	return intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;
}

function formatStatus(status: string | null): string {
	return status ? status.replaceAll('_', ' ') : 'Not configured';
}

function formatDate(date: Date | null): string {
	return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : '—';
}

function PlanDetail({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className='text-xs text-muted-foreground'>{label}</dt>
			<dd className='font-medium text-foreground'>{value}</dd>
		</div>
	);
}
