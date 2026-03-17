export type ColumnLineageNode = {
	name: string;
	source_name: string;
	expression?: string;
	reference_node_name?: string;
	sources: ColumnLineageNode[];
};

export type CitationPayload = {
	sql_query: string;
	database_id: string;
	tables: Array<{
		name: string;
	}>;
	column_lineage: ColumnLineageNode;
};
