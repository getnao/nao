import z from 'zod/v3';

export const QueryIdSchema = z.custom<`query_${string}`>(
	(value): value is `query_${string}` => typeof value === 'string' && /^query_.+$/.test(value),
	{ message: 'Expected a query id starting with "query_".' },
);
