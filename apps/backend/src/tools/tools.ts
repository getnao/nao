import { toolAgentHandler } from './toolAgentHandler';
import { ToolZodSchemas } from './types';

export const AgentTools = {
	read_file: {
		description: 'Read the contents of a file at a given path.',
		arguments: ToolZodSchemas.read_file.in,
		execute: toolAgentHandler.readFile,
	},
	search_files: {
		description: 'Search for files matching a specific pattern and return their paths.',
		arguments: ToolZodSchemas.search_files.in,
		execute: toolAgentHandler.searchFiles,
	},
	list_directory: {
		description: 'List the contents of a directory at a given path.',
		arguments: ToolZodSchemas.list_directory.in,
		execute: toolAgentHandler.listDirectory,
	},
	grep_codebase: {
		description: 'Search the codebase for a specific pattern and return matching lines with context.',
		arguments: ToolZodSchemas.grep_codebase.in,
		execute: toolAgentHandler.grepCodebase,
	},
	execute_sql: {
		description: 'Execute a SQL query against the connected database and return the results.',
		arguments: ToolZodSchemas.execute_sql.in,
		execute: toolAgentHandler.executeSql,
	},
};
