import { describe, expect, it } from 'vitest';

import type { DBOrganizationBilling } from '../src/db/abstractSchema';
import { toBillingSummary } from '../src/services/backoffice-billing.service';

describe('backoffice billing interval', () => {
	it.each([
		['cloud_team_monthly_v1', 'monthly'],
		['cloud_team_yearly_v1', 'yearly'],
		['cloud_unlimited_monthly_v1', 'monthly'],
		['cloud_unlimited_yearly_v1', 'yearly'],
		['cloud_monthly_v2', 'monthly'],
		['cloud_yearly_v1', 'yearly'],
		['unknown', null],
	] as const)('maps %s to %s', (billingPlan, interval) => {
		const billing = { billingPlan, billingStatus: 'active' } as DBOrganizationBilling;

		expect(toBillingSummary(false, billing).interval).toBe(interval);
	});
});
