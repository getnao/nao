export const TWO_FACTOR_METHODS = ['totp', 'email'] as const;

export type TwoFactorMethod = (typeof TWO_FACTOR_METHODS)[number];

export const DEFAULT_TWO_FACTOR_METHODS: TwoFactorMethod[] = ['totp', 'email'];

export interface TwoFactorStatus {
	enabled: boolean;
	method: TwoFactorMethod | null;
	hasPassword: boolean;
	allowedMethods: TwoFactorMethod[];
}
