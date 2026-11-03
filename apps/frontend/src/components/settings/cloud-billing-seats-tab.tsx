import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import type { CloudBillingStatus, OrganizationBillingState } from '@/hooks/use-organization-billing';
import { CloudBillingSeatsCard } from '@/components/settings/cloud-billing-seats-card';
import { Callout } from '@/components/ui/callout';

export function CloudBillingSeatsTab({
	data,
	billingState,
	currentPlanOffer,
	currentPlanSummary,
	teamPlanOffer,
	onChoosePlan,
}: {
	data: CloudBillingStatus;
	billingState: OrganizationBillingState;
	currentPlanOffer?: CloudPlanOffer;
	currentPlanSummary: { price?: string; promotionCodes?: string[] } | null;
	teamPlanOffer?: CloudPlanOffer;
	onChoosePlan: (plan: CloudPlanOffer) => void;
}) {
	const isTeamSeatQuantityUnavailable = data.access.tier === 'team' && data.access.seatQuantity === null;
	const seatOnlyPendingChange =
		data.current?.tier === 'team' &&
		data.pending?.planKey === data.current.planKey &&
		data.pending.seatQuantity !== null;

	return (
		<>
			{isTeamSeatQuantityUnavailable && (
				<Callout role='alert'>
					Team seat quantity is unavailable. Refresh billing details before changing membership.
				</Callout>
			)}
			<CloudBillingSeatsCard
				tier={data.access.tier}
				seatQuantity={data.access.seatQuantity}
				seatLimit={data.access.seatLimit}
				availableSeats={data.access.availableSeats}
				candidates={data.seatCandidates}
				pendingSeatQuantity={seatOnlyPendingChange ? data.pending?.seatQuantity : null}
				pendingSeatEffectiveAt={seatOnlyPendingChange ? data.pending?.effectiveAt : null}
				plan={currentPlanOffer}
				currentPlanPrice={currentPlanSummary?.price}
				currentPromotionCodes={currentPlanSummary?.promotionCodes}
				disabled={billingState.isBillingCommandPending || (data.scheduleConflict && !seatOnlyPendingChange)}
				onAddSeats={
					data.access.tier === 'free' && teamPlanOffer ? () => onChoosePlan(teamPlanOffer) : undefined
				}
				onPreviewSeatChange={data.current?.tier === 'team' ? billingState.previewSeatChange : undefined}
				onConfirmSeatChange={billingState.confirmSeatChange}
				onCancelPendingSeatChange={seatOnlyPendingChange ? billingState.cancelPendingPlanChange : undefined}
				onSaveSeatSelection={
					isTeamSeatQuantityUnavailable || data.access.tier === 'unlimited' || data.access.tier === 'bypass'
						? undefined
						: billingState.saveSeatSelection
				}
			/>
		</>
	);
}
