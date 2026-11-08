import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';

export type TwoFactorStatus = inferRouterOutputs<TrpcRouter>['twoFactor']['getStatus'];

export type TwoFactorMethod = TwoFactorStatus['allowedMethods'][number];

export const TWO_FACTOR_METHOD_LABELS: Record<TwoFactorMethod, string> = {
	totp: 'Authenticator app',
	email: 'Email code',
};

export function formatTwoFactorDeadline(deadline: Date): string {
	return deadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
