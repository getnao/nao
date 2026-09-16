import type { executeSemanticQuery } from '@nao/shared/tools';

import { Block, Span } from '../../lib/markdown';
import { ExecuteSqlOutput } from './execute-sql';

/** Rows only: the compiled SQL stays in the UI so the model adjusts the semantic query, not the SQL. */
export const ExecuteSemanticQueryOutput = ({ output }: { output: executeSemanticQuery.Output }) => {
	return (
		<Block>
			<ExecuteSqlOutput output={output} />
			<Span>
				Compiled by the semantic layer and executed on database {output.database_id}. To change the result, call
				execute_semantic_query again with different metrics, group_by, where or time bounds; do not rewrite it
				as SQL.
			</Span>
		</Block>
	);
};
