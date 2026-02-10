import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Updater } from '@tanstack/react-query';

/**
 * Represents a tRPC query procedure with queryKey and queryOptions methods.
 * This is the shape of procedures like `trpc.chat.list` or `trpc.chat.get`.
 */
type TrpcQueryProcedure = {
	queryKey: (...args: never[]) => readonly unknown[];
	queryOptions: (...args: never[]) => { queryFn?: (...args: never[]) => Promise<unknown> };
};

/**
 * Extracts the input parameters type from a tRPC procedure's queryKey method.
 * For `trpc.chat.list.queryKey()` -> []
 * For `trpc.chat.get.queryKey({ chatId })` -> [{ chatId: string }]
 */
type QueryKeyInput<T> = T extends { queryKey: (...args: infer P) => unknown } ? P : never;

/**
 * Extracts the output/data type from a tRPC procedure's queryOptions.
 * This is the type of data returned by the query.
 */
type QueryOutput<T> = T extends {
	queryOptions: (...args: never[]) => { queryFn?: (...args: never[]) => Promise<infer R> };
}
	? R
	: unknown;

/**
 * Creates a hook that returns a memoized setter function for a tRPC query's cache data.
 *
 * @param getProcedure - A function that returns the tRPC procedure. Using a function
 *                       avoids circular dependency issues at module load time.
 */
export function createQuerySetter<TProcedure extends TrpcQueryProcedure>(getProcedure: () => TProcedure) {
	type Input = QueryKeyInput<TProcedure>;
	type Output = QueryOutput<TProcedure>;
	type UpdaterType = Updater<Output | undefined, Output | undefined>;

	// Handle both cases: procedures with input and without
	// tRPC procedures with no input have queryKey(input?: void), so Input is [void?] not []
	type IsVoidInput = Input extends [] | [void] | [void?] ? true : false;
	type SetterFn = IsVoidInput extends true
		? (updater: UpdaterType) => void
		: (...args: [...Input, UpdaterType]) => void;

	return (): SetterFn => {
		const queryClient = useQueryClient();

		return useCallback(
			(...args: unknown[]) => {
				const procedure = getProcedure();
				// tRPC queryKey takes 0 or 1 argument, so setter has at most 2 args: (input, updater) or (updater)
				if (args.length === 2) {
					const input = args[0] as Input[0];
					const updater = args[1] as UpdaterType;
					queryClient.setQueryData(procedure.queryKey(input), updater);
				} else {
					const updater = args[0] as UpdaterType;
					queryClient.setQueryData(procedure.queryKey(), updater);
				}
			},
			[queryClient],
		);
	};
}
