import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';

import type { NewProjectSavedPrompt } from '../db/abstractSchema';

export const JAFFLE_SHOP_SAVED_PROMPTS: NewProjectSavedPrompt[] = [
	{
		id: 'system-example-monthly-revenue',
		projectId: SYSTEM_EXAMPLE_PROJECT_ID,
		title: 'How is monthly revenue trending?',
		prompt: 'How is monthly revenue trending?',
	},
	{
		id: 'system-example-top-customers',
		projectId: SYSTEM_EXAMPLE_PROJECT_ID,
		title: 'Make a chart of our top 5 customers by total revenue.',
		prompt: 'Make a chart of our top 5 customers by total revenue.',
	},
	{
		id: 'system-example-sales-performance-story',
		projectId: SYSTEM_EXAMPLE_PROJECT_ID,
		title: 'Create a story, using chart blocks, summarizing our sales performance and key customer trends.',
		prompt: 'Create a story, using chart blocks, summarizing our sales performance and key customer trends.',
	},
];
