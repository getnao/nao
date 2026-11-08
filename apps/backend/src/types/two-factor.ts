export const TWO_FACTOR_METHODS = ['totp', 'email'] as const;

export type TwoFactorMethod = (typeof TWO_FACTOR_METHODS)[number];

export const DEFAULT_TWO_FACTOR_METHODS: TwoFactorMethod[] = ['totp', 'email'];

export const DEFAULT_TWO_FACTOR_GRACE_PERIOD_DAYS = 7;

export const MAX_TWO_FACTOR_GRACE_PERIOD_DAYS = 90;

export interface TwoFactorStatus {
	enabled: boolean;
	method: TwoFactorMethod | null;
	hasPassword: boolean;
	allowedMethods: TwoFactorMethod[];
	required: boolean;
	requirement: TwoFactorRequirement | null;
}

/** Set while an organization requires two-factor authentication and the user has not set it up yet. */
export interface TwoFactorRequirement {
	deadline: Date;
	isOverdue: boolean;
}

/** The dates a member's grace period to set up two-factor authentication is counted from. */
export interface TwoFactorGracePeriod {
	requiredAt: Date;
	memberSince: Date;
	graceRestartedAt: Date | null;
	gracePeriodDays: number;
}
