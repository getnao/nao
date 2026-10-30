import { skipToken, useQuery } from '@tanstack/react-query';
import type { executeSemanticQuery } from '@nao/shared/tools';

import { trpc } from '@/main';

/** The metrics and dimensions of the semantic layer behind a query, or undefined until they load. */
export function useSemanticLayerCatalog(queryId: string | null): executeSemanticQuery.Catalog | undefined {
	const catalog = useQuery({
		...trpc.sql.semanticLayerCatalog.queryOptions(queryId ? { queryId } : skipToken),
		retry: false,
	});
	return catalog.data;
}
