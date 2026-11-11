import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';

export type TwoFactorStatus = inferRouterOutputs<TrpcRouter>['twoFactor']['getStatus'];

export type TwoFactorMethod = TwoFactorStatus['allowedMethods'][number];

export const TWO_FACTOR_METHOD_LABELS: Record<TwoFactorMethod, string> = {
	totp: 'Authenticator app',
	email: 'Email code',
};
