const shouldPrint = process.env.PRINT_OUTPUT === 'true';

const TOOL_COLORS: Record<string, string> = {
	execute_sql: '\x1b[36m', // cyan
	grep: '\x1b[33m', // yellow
	list: '\x1b[35m', // magenta
	read: '\x1b[32m', // green
	search: '\x1b[34m', // blue
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

/** When PRINT_OUTPUT=true, logs the rendered markdown for visual inspection alongside tests. */
export function printOutput(tool: string, description: string, markdown: string) {
	if (!shouldPrint) {
		return;
	}

	const title = `${tool} — ${description}`;
	const color = TOOL_COLORS[tool] ?? '';

	console.log(`\n${DIM}${'─'.repeat(60)}${RESET}`);
	console.log(`  ${color}${title}${RESET}`);
	console.log(`${DIM}${'─'.repeat(60)}${RESET}\n`);
	console.log(markdown);
}
