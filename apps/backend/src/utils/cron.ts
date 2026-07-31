/** Models like to wrap the expression in backticks, sometimes as a fenced block with a language tag. */
export function sanitizeCron(answer: string): string {
	const fenced = answer.trim().match(/^```[a-zA-Z0-9-]*\n([\s\S]*?)\n?```$/);
	return (fenced ? fenced[1] : answer).replace(/^`+|`+$/g, '').trim();
}
