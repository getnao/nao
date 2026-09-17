import { SearchSubagentPrompt } from '../../components/ai';
import { renderToMarkdown } from '../../lib/markdown';
import { isTypesafeConfigured } from '../../services/typesafe';
import { readProjectContext } from '../../utils/nao-config';
import { truncateMiddle } from '../../utils/utils';
import grep from '../tools/grep';
import list from '../tools/list';
import read from '../tools/read';
import search from '../tools/search';
import semanticSearch from '../tools/semantic-search';
import { getUserRules } from '../user-rules';
import type { SubagentDefinition } from './types';

const USER_RULES_MAX_CHARS = 6_000;

export const searchSubagent: SubagentDefinition = {
	name: 'search',
	whenToUse:
		'Finds the project context a question needs (tables, columns, joins, metric definitions, docs, rules) and reports it with file paths. Use it when the relevant context is not yet known in the conversation and finding it would take more than a couple of lookups.',
	maxSteps: 15,
	tools: () => ({
		read,
		list,
		grep,
		search,
		...(isTypesafeConfigured() && { semantic_search: semanticSearch }),
	}),
	systemPrompt: (context) => {
		const { repos, templates, presence } = readProjectContext(context.projectFolder);
		const userRules = getUserRules(context.projectFolder);
		return renderToMarkdown(
			SearchSubagentPrompt({
				templates,
				repoNames: repos.map((repo) => repo.name),
				contextPresence: presence,
				hasSemanticSearch: isTypesafeConfigured(),
				userRules: userRules ? truncateMiddle(userRules, USER_RULES_MAX_CHARS) : undefined,
			}),
		);
	},
};
