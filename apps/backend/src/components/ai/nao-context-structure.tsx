import { Block, Italic, List, ListItem, Title } from '../../lib/markdown';

/** Explains how the nao project context is laid out on disk. Shared by every system prompt. */
export function NaoContextStructure() {
	return (
		<Block>
			<Title level={2}>How nao Works</Title>
			<List>
				<ListItem>All the context available to you is stored as files in the project folder.</ListItem>
				<ListItem>
					In the <Italic>databases</Italic> folder you can find the databases context, each layer is a folder
					from the databases, schema and then tables.
				</ListItem>
				<ListItem>
					Folders are named like this: database=my_database, schema=my_schema, table=my_table.
				</ListItem>
				<ListItem>
					Databases folders are named following this pattern: type={`<database_type>`}/database=
					{`<database_name>`}/schema={`<schema_name>`}/table={`<table_name>`}.
				</ListItem>
				<ListItem>
					Each table has files describing the table schema and the data in the table (like columns.md,
					preview.md, etc.)
				</ListItem>
			</List>
		</Block>
	);
}
