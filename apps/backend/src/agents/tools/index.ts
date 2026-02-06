import { type AnyToolDefinition, createTool } from '../../types/tools';
import displayChart from './definitions/display-chart';
import executePython from './definitions/execute-python';
import executeSql from './definitions/execute-sql';
import grep from './definitions/grep';
import list from './definitions/list';
import read from './definitions/read';
import search from './definitions/search';

const allTools: AnyToolDefinition[] = [displayChart, executePython, executeSql, grep, list, read, search];

export const tools = Object.fromEntries(allTools.map((def) => [def.name, createTool(def).tool]));

// Schema re-exports for external use
export * as displayChartSchemas from './schema/display-chart';
export * as executePythonSchemas from './schema/execute-python';
export * as executeSqlSchemas from './schema/execute-sql';
export * as grepSchemas from './schema/grep';
export * as listSchemas from './schema/list';
export * as readFileSchemas from './schema/read';
export * as searchFilesSchemas from './schema/search';
