import { tool } from 'ai';
import z from 'zod/v3';

export const tools = {
	getWeather: tool({
		description: 'Get the current weather for a specified city. Use this when the user asks about weather.',
		inputSchema: z.object({
			city: z.string().describe('The city to get the weather for'),
		}),
		outputSchema: z.object({
			condition: z.string(),
			temperature: z.string(),
			humidity: z.string(),
			wind: z.string(),
		}),
		execute: async ({ city }) => {
			await new Promise((resolve) => setTimeout(resolve, 3000));
			return {
				condition: 'sunny',
				temperature: '20°C',
				humidity: '50%',
				wind: '10 km/h',
			};
		},
	}),
};
