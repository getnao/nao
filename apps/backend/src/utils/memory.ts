/** Categories of memories that can be extracted from user messages. Ordered by priority. */
export const MEMORY_CATEGORIES = ['global_rule', 'personal_fact'] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_TOKEN_LIMIT = 1000;
