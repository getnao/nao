import type Stripe from 'stripe';

import type { OrgRole } from '../types/organization';

const CHANGE_INTENT_METADATA_KEY = 'nao_change_intent';

/** Work a billing command must finish once Stripe applies its subscription update, possibly after payment. */
export type CloudSubscriptionChangeIntent = {
	target: string;
	releaseScheduleId?: string;
	member?: { userId: string; role: OrgRole };
};

export function stripeId(value: string | { id: string } | null): string {
	if (!value) {
		throw new Error('Stripe object reference is missing');
	}
	return typeof value === 'string' ? value : value.id;
}

export function cloudSubscriptionChangeIntentMetadata(
	intent: CloudSubscriptionChangeIntent | null,
): Stripe.MetadataParam {
	return { [CHANGE_INTENT_METADATA_KEY]: intent ? JSON.stringify(intent) : '' };
}

export function readCloudSubscriptionChangeIntent(
	metadata: Stripe.Metadata | null | undefined,
): CloudSubscriptionChangeIntent | null {
	const value = metadata?.[CHANGE_INTENT_METADATA_KEY];
	if (!value) {
		return null;
	}
	try {
		return JSON.parse(value) as CloudSubscriptionChangeIntent;
	} catch {
		return null;
	}
}
