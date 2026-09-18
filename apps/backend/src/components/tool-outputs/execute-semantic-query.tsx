import type { executeSemanticQuery } from '@nao/shared/tools';

import { Block, Span } from '../../lib/markdown';
import { ExecuteSqlOutput } from './execute-sql';

const LIMIT_REACHED_ADVICE =
	'To see whether more rows exist, call execute_semantic_query again with a higher limit or without one.';

/** Rows only: the compiled SQL stays in the UI so the model adjusts the semantic query, not the SQL. */
export const ExecuteSemanticQueryOutput = ({ output }: { output: executeSemanticQuery.Output }) => {
	return (
		<Block>
			<ExecuteSqlOutput output={output} limitReachedAdvice={LIMIT_REACHED_ADVICE} />
			<Span>
				Compiled by the semantic layer and executed on database {output.database_id}. To change the result, call
				execute_semantic_query again with different metrics, group_by, where or time bounds; do not rewrite it
				as SQL.
			</Span>
		</Block>
	);
};
