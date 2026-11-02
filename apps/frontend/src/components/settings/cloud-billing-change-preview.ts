export type CloudBillingChangePreview = {
	amountDue: number;
	subtotal: number;
	tax: number;
	discount: number;
	currency: string;
	lines: Array<{
		description: string;
		amount: number;
		currency: string;
		proration: boolean;
		periodStartsAt: Date | null;
		periodEndsAt: Date | null;
	}>;
	previewToken: string;
	expiresAt: Date;
	effective: 'immediate' | 'period_end';
	effectiveAt: Date;
	firstChargeAt: Date | null;
	promotionCodeDiscount: {
		amount: number;
		duration: string;
	} | null;
	readOnlyUsersAfterChange: Array<{ userId: string; name: string; email: string }>;
} | null;
