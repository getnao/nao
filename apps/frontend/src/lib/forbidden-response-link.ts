import { observable } from '@trpc/server/observable';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { TRPCLink } from '@trpc/client';

/** Sees every tRPC call, including direct `trpcClient` calls that bypass the query cache. */
export function createForbiddenResponseLink(onForbidden: () => void): TRPCLink<TrpcRouter> {
	return () => {
		return ({ next, op }) => {
			return observable((observer) => {
				const subscription = next(op).subscribe({
					next(result) {
						observer.next(result);
					},
					error(error) {
						observer.error(error);
						if (error.data?.code === 'FORBIDDEN') {
							queueMicrotask(onForbidden);
						}
					},
					complete() {
						observer.complete();
					},
				});

				return () => {
					subscription.unsubscribe();
				};
			});
		};
	};
}
