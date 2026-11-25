import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';

import type { OrganizationCreditsTab } from '@/components/settings/credits-wallet-content';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plans';
import type { TabBarItem } from '@/components/ui/tab-bar';
import type {
	CloudBillingStatus,
	OrganizationBillingSearch,
	OrganizationBillingState,
	OrganizationBillingTab,
} from '@/hooks/use-organization-billing';
import { CloudBillingChangeDialog } from '@/components/settings/cloud-billing-change-dialog';
import {
	CloudBillingPlans,
	formatCloudPlanPrice,
	getCloudPlanName,
	getCloudPlanOffers,
} from '@/components/settings/cloud-billing-plans';
import { CloudBillingSeats } from '@/components/settings/cloud-billing-seats';
import { CloudBillingSwitchToFreeDialog } from '@/components/settings/cloud-billing-switch-to-free-dialog';
import { OrganizationCreditsContent } from '@/components/settings/credits-wallet-content';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { useOrganizationBilling } from '@/hooks/use-organization-billing';
import { usePermissions } from '@/hooks/use-permissions';
import {
	formatBillingDate,
	formatBillingPrice,
	formatBillingStatus,
	formatInvoiceLabel,
	getBillingManagementDescription,
	getBillingPortalButtonLabel,
} from '@/lib/billing-display';

const TAB_ID_BASE = 'organization-billing';

type BillingDialog =
	| { kind: 'change'; plan: CloudPlanOffer; checkout: boolean; adjustSeats?: boolean }
	| { kind: 'free' };

export function OrganizationBillingSettings({
	search,
	onTabChange,
	onCreditsTabChange,
}: {
	search: OrganizationBillingSearch;
	onTabChange?: (tab: OrganizationBillingTab) => void;
	onCreditsTabChange?: (tab: OrganizationCreditsTab) => void;
}) {
	const billingState = useOrganizationBilling(search);
	const { canViewChatReplay } = usePermissions();
	const [dialog, setDialog] = useState<BillingDialog | null>(null);
	const data = billingState.billing.data;

	if (billingState.isCheckoutPolling) {
		return <BillingActivationState plan={search.checkoutPlan} />;
	}

	const tabs = getBillingTabs(data);
	const requestedTab =
		search.tab ??
		(search.creditCheckout || search.creditsTab ? 'credits' : search.portal === 'returned' ? 'invoices' : 'plans');
	const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : 'plans';
	const choosePlan = (plan: CloudPlanOffer) => {
		if (data?.plan || plan.tier === 'team') {
			setDialog({ kind: 'change', plan, checkout: !data?.plan });
			return;
		}
		void billingState.startCheckout(plan.key).catch(() => undefined);
	};

	return (
		<SettingsPageWrapper wide>
			<div className='flex flex-col gap-5'>
				<BillingHeader billingState={billingState} />
				<TabBar
					tabs={tabs}
					activeTab={activeTab}
					onTabChange={(tab) => onTabChange?.(tab)}
					idBase={TAB_ID_BASE}
					label='Billing sections'
					className='border-b'
				/>
				<BillingFeedback billingState={billingState} />
				<TabPanel idBase={TAB_ID_BASE} tabId={activeTab} className='flex flex-col gap-8'>
					{activeTab === 'credits' ? (
						<OrganizationCreditsContent
							creditCheckout={search.creditCheckout}
							canViewReplay={canViewChatReplay}
							activeTab={search.creditsTab ?? 'history'}
							onTabChange={onCreditsTabChange}
						/>
					) : !data ? (
						<p
							className={
								billingState.billing.isError
									? 'text-sm text-destructive'
									: 'text-sm text-muted-foreground'
							}
							role={billingState.billing.isError ? 'alert' : 'status'}
						>
							{billingState.billing.isError
								? 'Unable to load billing details.'
								: 'Loading billing details…'}
						</p>
					) : activeTab === 'seats' ? (
						<CloudBillingSeats
							data={data}
							disabled={billingState.isCommandPending}
							onUpgrade={() =>
								choosePlan(getPlanOffer(data, 'team', billingState.selectedBillingInterval))
							}
							onAdjustSeats={
								data.plan?.tier === 'team' && !data.plan.legacy && data.tier === 'team'
									? () =>
											setDialog({
												kind: 'change',
												plan: getCurrentPlanOffer(data)!,
												checkout: false,
												adjustSeats: true,
											})
									: undefined
							}
							onSelectSeats={billingState.selectSeats}
						/>
					) : activeTab === 'invoices' ? (
						<>
							<InvoicesCard billingState={billingState} />
							<BillingManagementCard billingState={billingState} />
						</>
					) : (
						<CloudBillingPlans
							data={data}
							billingState={billingState}
							onChoosePlan={choosePlan}
							onSwitchToFree={() => setDialog({ kind: 'free' })}
						/>
					)}
				</TabPanel>
			</div>
			{data && (
				<>
					<CloudBillingChangeDialog
						open={dialog?.kind === 'change'}
						onOpenChange={(open) => !open && setDialog(null)}
						{...getChangeDialogProps(data, dialog)}
						seatUserCount={data.members.length}
						onCheckout={
							dialog?.kind === 'change' && dialog.checkout
								? (seats) => billingState.startCheckout(dialog.plan.key, seats)
								: undefined
						}
						onPreview={
							dialog?.kind === 'change'
								? (seats, promotionCode) =>
										billingState.previewChange(dialog.plan.key, seats, promotionCode)
								: undefined
						}
						onConfirm={billingState.confirmChange}
					/>
					<CloudBillingSwitchToFreeDialog
						open={dialog?.kind === 'free'}
						onOpenChange={(open) => !open && setDialog(null)}
						data={data}
						onConfirm={billingState.switchToFree}
					/>
				</>
			)}
		</SettingsPageWrapper>
	);
}

function getBillingTabs(data: CloudBillingStatus | undefined): TabBarItem<OrganizationBillingTab>[] {
	return [
		{ id: 'plans', label: 'Plans' },
		...(data && !data.trialAvailable ? [{ id: 'seats' as const, label: 'Seats' }] : []),
		{ id: 'credits', label: 'Credits' },
		...(data?.invoiceHistoryAvailable || data?.paidPlanSelected
			? [{ id: 'invoices' as const, label: 'Invoices & payment' }]
			: []),
	];
}

function getPlanOffer(data: CloudBillingStatus, tier: CloudPlanOffer['tier'], interval: CloudPlanOffer['interval']) {
	return getCloudPlanOffers(data.currency).find((plan) => plan.tier === tier && plan.interval === interval)!;
}

function getCurrentPlanOffer(data: CloudBillingStatus) {
	return getCloudPlanOffers(data.currency).find((plan) => plan.key === data.plan?.key);
}

function getChangeDialogProps(data: CloudBillingStatus, dialog: BillingDialog | null) {
	if (dialog?.kind !== 'change') {
		return { title: '', description: '', plan: null };
	}
	const tierName = dialog.plan.tier === 'team' ? 'Team' : 'Unlimited';
	if (dialog.checkout) {
		return {
			title: `Choose ${tierName} seats`,
			description: 'Choose how many full-access seats to pay for. Viewers remain free.',
			plan: dialog.plan,
			initialSeats: Math.min(TEAM_MAX_SEATS, Math.max(TEAM_MIN_SEATS, data.members.length)),
		};
	}
	const currentOffer = getCurrentPlanOffer(data);
	return {
		title: dialog.adjustSeats ? 'Adjust seats' : `Change to ${tierName}`,
		description: dialog.adjustSeats
			? 'Seat increases apply now with a prorated charge. Decreases apply at your next renewal.'
			: "Choose your plan options, then review Stripe's final totals.",
		plan: dialog.plan,
		initialSeats: dialog.plan.tier === 'team' ? (data.pending?.seats ?? data.seatQuantity) : null,
		current: currentOffer && {
			badge: data.tier === 'trial' ? 'Selected after trial' : 'Current',
			name: getCloudPlanName(currentOffer.tier, data.seatQuantity),
			price: formatCloudPlanPrice(currentOffer, data.seatQuantity),
		},
	};
}

function BillingActivationState({ plan }: { plan: OrganizationBillingSearch['checkoutPlan'] }) {
	const title = `Activating your ${plan === 'team' ? 'Team plan' : plan === 'unlimited' ? 'Unlimited plan' : 'new plan'}…`;
	return (
		<SettingsPageWrapper wide>
			<div className='flex flex-1 items-center justify-center py-16 text-center' aria-live='polite'>
				<div className='flex max-w-md flex-col items-center gap-3'>
					<Spinner className='size-7 text-primary opacity-100' aria-label={title} />
					<div>
						<h1 className='text-lg font-semibold text-foreground'>{title}</h1>
						<p className='mt-1 text-sm text-muted-foreground'>
							We&apos;re securely confirming your subscription with Stripe. This usually takes only a
							moment.
						</p>
					</div>
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

function BillingHeader({ billingState }: { billingState: OrganizationBillingState }) {
	return (
		<div className='flex items-start justify-between gap-3'>
			<div>
				<h1 className='text-lg font-semibold text-foreground'>Billing & Credits</h1>
				<p className='text-sm text-muted-foreground'>
					Manage plans, seats, invoices, and your organization&apos;s nao credits.
				</p>
				{billingState.syncError && (
					<p className='mt-1 text-sm text-destructive' role='alert'>
						{billingState.syncError}
					</p>
				)}
			</div>
			<Button
				variant='secondary'
				size='icon'
				onClick={billingState.syncBilling}
				isLoading={billingState.isBillingSyncPending}
				aria-label='Refresh billing details'
				title='Refresh billing details'
			>
				{!billingState.isBillingSyncPending && <RefreshCwIcon />}
			</Button>
		</div>
	);
}

function BillingFeedback({ billingState }: { billingState: OrganizationBillingState }) {
	if (!billingState.checkoutFeedback && !billingState.portalFeedback) {
		return null;
	}

	return (
		<div
			className='flex flex-col items-start gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground'
			role='status'
			aria-live='polite'
		>
			{billingState.checkoutFeedback && <p>{billingState.checkoutFeedback}</p>}
			{billingState.portalFeedback && <p>{billingState.portalFeedback}</p>}
			{billingState.isCheckoutConfirmationDelayed && (
				<Button variant='secondary' size='sm' onClick={billingState.retryCheckoutConfirmation}>
					Refresh status
				</Button>
			)}
		</div>
	);
}

function InvoicesCard({ billingState }: { billingState: OrganizationBillingState }) {
	const { billing, invoices } = billingState;
	if (!billing.data?.invoiceHistoryAvailable) {
		return null;
	}

	return (
		<SettingsCard title='Invoices'>
			{invoices.isLoading ? (
				<p className='text-sm text-muted-foreground' role='status' aria-live='polite'>
					Loading invoices…
				</p>
			) : invoices.isError ? (
				<p className='text-sm text-destructive' role='alert'>
					Unable to load invoices.
				</p>
			) : invoices.data?.length ? (
				<div className='flex flex-col divide-y divide-border'>
					{invoices.data.map((invoice) => (
						<div
							key={invoice.id}
							className='flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between'
						>
							<div>
								<div className='flex items-center gap-2'>
									<p className='font-medium text-foreground'>
										{formatInvoiceLabel(invoice.createdAt)}
									</p>
									<Badge variant='secondary'>
										{invoice.invoiceKind === 'trial'
											? 'Trial'
											: invoice.invoiceKind === 'no_charge'
												? 'No charge'
												: invoice.invoiceKind === 'credit_top_up'
													? 'Nao credits'
													: invoice.planTier === 'team'
														? 'Team'
														: invoice.planTier === 'unlimited'
															? 'Unlimited'
															: 'Subscription'}
									</Badge>
									{invoice.invoiceKind === 'subscription' &&
										invoice.promotionCodes.map((code) => (
											<Badge key={code} variant='outline'>
												Code {code}
											</Badge>
										))}
								</div>
								<p className='text-sm text-muted-foreground'>
									{invoice.invoiceKind === 'trial'
										? `${formatBillingDate(invoice.createdAt)} · No charge during trial`
										: invoice.invoiceKind === 'no_charge'
											? `${formatBillingDate(invoice.createdAt)} · No charge`
											: `${formatBillingDate(invoice.createdAt)} · ${formatBillingPrice(invoice.total, invoice.currency)} · ${formatBillingStatus(invoice.status)}`}
								</p>
								{invoice.number && <p className='text-xs text-muted-foreground'>{invoice.number}</p>}
							</div>
							<div className='flex flex-wrap gap-2'>
								{invoice.hostedInvoiceUrl && (
									<Button variant='secondary' size='sm' asChild>
										<a href={invoice.hostedInvoiceUrl} target='_blank' rel='noreferrer'>
											View invoice
										</a>
									</Button>
								)}
								{invoice.invoicePdf && (
									<Button variant='secondary' size='sm' asChild>
										<a href={invoice.invoicePdf} target='_blank' rel='noreferrer'>
											Download PDF
										</a>
									</Button>
								)}
							</div>
						</div>
					))}
				</div>
			) : (
				<p className='text-sm text-muted-foreground'>No invoices yet.</p>
			)}
		</SettingsCard>
	);
}

function BillingManagementCard({ billingState }: { billingState: OrganizationBillingState }) {
	const { billing, paidPlanSelected, status } = billingState;
	if (!billing.data || !paidPlanSelected) {
		return null;
	}

	return (
		<SettingsCard title='Billing management'>
			<div className='flex flex-col items-start gap-3'>
				{billing.data.portalAvailable || billing.data.paymentMethodManagementAvailable ? (
					<>
						<p className='text-sm text-muted-foreground'>
							{getBillingManagementDescription(status, billing.data.hasDefaultPaymentMethod === true)}
						</p>
						<div className='flex flex-wrap gap-2'>
							{billing.data.paymentMethodManagementAvailable && (
								<Button
									onClick={billingState.openPaymentMethodPortal}
									isLoading={billingState.isPaymentMethodPortalPending}
								>
									Manage payment method
								</Button>
							)}
							{billing.data.portalAvailable && (
								<Button
									variant='secondary'
									onClick={billingState.openPortal}
									isLoading={billingState.isPortalPending}
								>
									{getBillingPortalButtonLabel(status)}
								</Button>
							)}
							{status === 'paused' && (
								<Button
									variant='secondary'
									onClick={billingState.resume}
									isLoading={billingState.isResumePending}
								>
									Resume subscription
								</Button>
							)}
						</div>
						{status === 'trialing' && (
							<p className='text-xs text-muted-foreground'>
								Without a payment method, Stripe pauses the subscription when the trial ends.
							</p>
						)}
					</>
				) : (
					<p className='text-sm text-muted-foreground'>
						Billing management is not available for this subscription.
					</p>
				)}
				{billingState.managementError && (
					<p className='text-sm text-destructive' role='alert'>
						{billingState.managementError}
					</p>
				)}
			</div>
		</SettingsCard>
	);
}
