import { useState } from 'react';
import type { ReactNode } from 'react';

import type { OrganizationCreditsTab } from '@/components/settings/credits-wallet-content';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import type {
	OrganizationBillingSearch,
	OrganizationBillingState,
	OrganizationBillingTab,
} from '@/hooks/use-organization-billing';

import { BillingInvoicesTab } from '@/components/settings/billing-invoices-tab';
import { CloudBillingPlanChangeDialog } from '@/components/settings/cloud-billing-plan-change-dialog';
import {
	CloudBillingPlansTab,
	formatCloudPlanRecurringPrice,
	getCloudPlanName,
} from '@/components/settings/cloud-billing-plans-tab';
import { CloudBillingSeatsTab } from '@/components/settings/cloud-billing-seats-tab';
import { CloudBillingSwitchToFreeDialog } from '@/components/settings/cloud-billing-switch-to-free-dialog';
import { CloudBillingTeamSeatsDialog } from '@/components/settings/cloud-billing-team-seats-dialog';
import { OrganizationCreditsContent } from '@/components/settings/credits-wallet-content';
import { LegacyBillingPlansTab } from '@/components/settings/legacy-billing-plans-tab';
import { Button } from '@/components/ui/button';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { useOrganizationBilling } from '@/hooks/use-organization-billing';
import { usePermissions } from '@/hooks/use-permissions';
import { formatBillingPrice } from '@/lib/billing-display';
import { cn } from '@/lib/utils';

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
	const activeTab = getActiveBillingTab(search, billingState.freeTierEnabled);
	const creditsSection = (
		<OrganizationCreditsSection
			search={search}
			canViewChatReplay={canViewChatReplay}
			onCreditsTabChange={onCreditsTabChange}
		/>
	);

	if (billingState.isCheckoutPolling) {
		return <BillingActivationState plan={search.checkoutPlan} />;
	}

	if (billingState.freeTierEnabled) {
		return (
			<CloudOrganizationBillingSettings
				billingState={billingState}
				activeTab={activeTab}
				creditsSection={creditsSection}
				onTabChange={onTabChange}
			/>
		);
	}

	return (
		<SettingsPageWrapper wide>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Billing & Credits</h1>
					<p className='text-sm text-muted-foreground'>
						Review your current plan, subscription history, invoices, and billing actions.
					</p>
				</div>

				<BillingTabs
					activeTab={activeTab}
					tabs={billingTabs.filter((tab) => tab.value !== 'seats')}
					onTabChange={onTabChange}
				/>
				<BillingFeedback billingState={billingState} />

				{activeTab === 'plans' && <LegacyBillingPlansTab billingState={billingState} />}
				{activeTab === 'credits' && creditsSection}
				{activeTab === 'invoices' && <BillingInvoicesTab billingState={billingState} />}
			</div>
		</SettingsPageWrapper>
	);
}

function BillingActivationState({ plan }: { plan: OrganizationBillingSearch['checkoutPlan'] }) {
	const planName = plan === 'team' ? 'Team plan' : plan === 'unlimited' ? 'Unlimited plan' : 'new plan';
	const title = `Activating your ${planName}…`;

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

function CloudOrganizationBillingSettings({
	billingState,
	activeTab,
	creditsSection,
	onTabChange,
}: {
	billingState: OrganizationBillingState;
	activeTab: OrganizationBillingTab;
	creditsSection: ReactNode;
	onTabChange?: (tab: OrganizationBillingTab) => void;
}) {
	const [switchToFreeOpen, setSwitchToFreeOpen] = useState(false);
	const [selectedTeamPlan, setSelectedTeamPlan] = useState<CloudPlanOffer | null>(null);
	const [selectedPlanChange, setSelectedPlanChange] = useState<CloudPlanOffer | null>(null);
	const data = billingState.billing.data;
	if (!data || !('access' in data)) {
		return (
			<SettingsPageWrapper wide>
				<p role='status'>Loading billing details…</p>
			</SettingsPageWrapper>
		);
	}

	const plans = data.availablePlans as CloudPlanOffer[];
	const visibleTabs = billingTabs.filter(({ value }) => {
		if (value === 'seats') {
			return !data.trialAvailable;
		}
		if (value === 'credits') {
			return data.access.tier === 'bypass' || !data.trialAvailable || data.invoiceHistoryAvailable;
		}
		if (value === 'invoices') {
			return data.invoiceHistoryAvailable || data.paidPlanSelected;
		}
		return true;
	});
	const visibleActiveTab = visibleTabs.some(({ value }) => value === activeTab) ? activeTab : 'plans';
	const currentPlanOffer = data.current ? plans.find((plan) => plan.planKey === data.current?.planKey) : undefined;
	const teamPlanOffer = plans.find(
		(plan) => plan.tier === 'team' && plan.interval === billingState.selectedBillingInterval,
	);
	const upcomingPayment =
		billingState.canLoadUpcomingInvoice &&
		!billingState.upcomingInvoice.isLoading &&
		!billingState.upcomingInvoice.isError
			? billingState.upcomingInvoice.data
			: null;
	const discountedCurrentAmount =
		upcomingPayment &&
		upcomingPayment.promotionCodes.length > 0 &&
		upcomingPayment.currency === currentPlanOffer?.currency
			? upcomingPayment.amountDue
			: undefined;
	const currentPlanSummary = data.current
		? {
				name: getCloudPlanName(data.current.tier, data.current.seatQuantity),
				price: currentPlanOffer
					? formatCloudPlanRecurringPrice(
							currentPlanOffer,
							data.current.seatQuantity,
							discountedCurrentAmount,
						)
					: undefined,
				promotionCodes: discountedCurrentAmount !== undefined ? upcomingPayment?.promotionCodes : undefined,
			}
		: null;
	const planChangeBaseline =
		data.access.tier === 'trial'
			? data.cancellationScheduled
				? {
						badge: 'Selected after trial',
						name: 'Free',
						price: `${formatBillingPrice(0, selectedPlanChange?.currency ?? 'usd')} forever`,
					}
				: currentPlanSummary && { ...currentPlanSummary, badge: 'Selected after trial' }
			: currentPlanSummary;
	const currentPlanEndsAt =
		data.access.tier === 'trial' ? (data.access.trialEndsAt ?? data.currentPeriodEndsAt) : data.currentPeriodEndsAt;
	const startPlanCheckout = async (plan: CloudPlanOffer, seatQuantity?: number) => {
		if (data.needsPaidPlanSelection) {
			billingState.openTrialCheckoutForPlan(plan.planKey, seatQuantity);
		} else {
			billingState.resubscribeForPlan(plan.planKey, seatQuantity);
		}
	};
	const choosePlan = (plan: CloudPlanOffer) => {
		if (data.current) {
			setSelectedPlanChange(plan);
			return;
		}
		if (plan.tier === 'team') {
			setSelectedTeamPlan(plan);
			return;
		}
		void startPlanCheckout(plan);
	};

	return (
		<>
			<SettingsPageWrapper wide>
				<div className='flex flex-col gap-5'>
					<div>
						<h1 className='text-lg font-semibold text-foreground'>Billing & Credits</h1>
						<p className='text-sm text-muted-foreground'>
							Manage plans, paid capacity, invoices, and your organization&apos;s nao credits.
						</p>
					</div>
					<BillingTabs activeTab={visibleActiveTab} tabs={visibleTabs} onTabChange={onTabChange} />
					<BillingFeedback billingState={billingState} />
					{visibleActiveTab === 'plans' && (
						<CloudBillingPlansTab
							data={data}
							plans={plans}
							billingState={billingState}
							onChoosePlan={choosePlan}
							onSwitchToFree={() => setSwitchToFreeOpen(true)}
						/>
					)}
					{visibleActiveTab === 'seats' && (
						<CloudBillingSeatsTab
							data={data}
							billingState={billingState}
							currentPlanOffer={currentPlanOffer}
							currentPlanSummary={currentPlanSummary}
							teamPlanOffer={teamPlanOffer}
							onChoosePlan={choosePlan}
						/>
					)}
					{visibleActiveTab === 'credits' && creditsSection}
					{visibleActiveTab === 'invoices' && <BillingInvoicesTab billingState={billingState} />}
				</div>
			</SettingsPageWrapper>
			<CloudBillingPlanChangeDialog
				open={selectedPlanChange !== null}
				onOpenChange={(open) => !open && setSelectedPlanChange(null)}
				plan={selectedPlanChange}
				currentPlan={planChangeBaseline}
				disabled={billingState.isPlanSelectionPending}
				onPreview={(seatQuantity, promotionCode) => {
					if (!selectedPlanChange) {
						return Promise.resolve(null);
					}
					return promotionCode
						? billingState.previewPlanChange(selectedPlanChange.planKey, seatQuantity, promotionCode)
						: billingState.previewPlanChange(selectedPlanChange.planKey, seatQuantity);
				}}
				onConfirm={(preview) => billingState.confirmPlanChange(preview.previewToken)}
			/>
			<CloudBillingTeamSeatsDialog
				open={selectedTeamPlan !== null}
				plan={selectedTeamPlan}
				seatUserCount={data.access.seatUserCount}
				trialing={data.access.tier === 'trial'}
				redirectsToCheckout={!data.current}
				disabled={billingState.isPlanSelectionPending}
				onOpenChange={(open) => !open && setSelectedTeamPlan(null)}
				onConfirm={startPlanCheckout}
			/>
			<CloudBillingSwitchToFreeDialog
				open={switchToFreeOpen}
				onOpenChange={setSwitchToFreeOpen}
				effectiveAt={currentPlanEndsAt}
				candidates={data.seatCandidates}
				trialing={data.access.tier === 'trial'}
				onConfirm={billingState.switchToFree}
			/>
		</>
	);
}

const billingTabs: Array<{ label: string; value: OrganizationBillingTab }> = [
	{ label: 'Plans', value: 'plans' },
	{ label: 'Seats', value: 'seats' },
	{ label: 'Credits', value: 'credits' },
	{ label: 'Invoices & payment', value: 'invoices' },
];

function BillingTabs({
	activeTab,
	tabs,
	onTabChange,
}: {
	activeTab: OrganizationBillingTab;
	tabs: Array<{ label: string; value: OrganizationBillingTab }>;
	onTabChange?: (tab: OrganizationBillingTab) => void;
}) {
	return (
		<div className='overflow-x-auto border-b border-border'>
			<div className='flex min-w-max gap-6' role='tablist' aria-label='Billing sections'>
				{tabs.map((tab) => (
					<button
						key={tab.value}
						type='button'
						role='tab'
						aria-selected={activeTab === tab.value}
						className={cn(
							'cursor-pointer border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
							activeTab === tab.value
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
						onClick={() => onTabChange?.(tab.value)}
					>
						{tab.label}
					</button>
				))}
			</div>
		</div>
	);
}

function getActiveBillingTab(search: OrganizationBillingSearch, seatsAvailable: boolean): OrganizationBillingTab {
	const requestedTab =
		search.tab ??
		(search.creditCheckout || search.creditsTab ? 'credits' : search.portal === 'returned' ? 'invoices' : 'plans');
	return requestedTab === 'seats' && !seatsAvailable ? 'plans' : requestedTab;
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

function OrganizationCreditsSection({
	search,
	canViewChatReplay,
	onCreditsTabChange,
}: {
	search: OrganizationBillingSearch;
	canViewChatReplay: boolean;
	onCreditsTabChange?: (tab: OrganizationCreditsTab) => void;
}) {
	return (
		<section className='flex flex-col gap-4'>
			<div>
				<h2 className='text-base font-semibold text-foreground'>Organization credits</h2>
				<p className='text-sm text-muted-foreground'>
					Fund and review the shared nao AI wallet for this organization.
				</p>
			</div>
			<OrganizationCreditsContent
				creditCheckout={search.creditCheckout}
				canViewReplay={canViewChatReplay}
				activeTab={search.creditsTab ?? 'history'}
				onTabChange={onCreditsTabChange}
			/>
		</section>
	);
}
