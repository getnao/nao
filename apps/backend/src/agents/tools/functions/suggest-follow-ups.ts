import type { Input, Output } from '../schema/suggest-follow-ups';

export const execute = async (_input: Input): Promise<Output> => {
	// The tool just validates and passes through the suggestions
	// The actual display is handled by the frontend
	return { success: true };
};
