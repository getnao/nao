import { CronExpressionParser } from 'cron-parser';

const MIN_TEST_SCHEDULE_INTERVAL_MS = 60 * 60_000;
const CHECKED_TEST_SCHEDULE_TICKS = 24;

/** Models like to wrap the expression in backticks, sometimes as a fenced block with a language tag. */
export function sanitizeCron(answer: string): string {
	const fenced = answer.trim().match(/^```[a-zA-Z0-9-]*\n([\s\S]*?)\n?```$/);
	return (fenced ? fenced[1] : answer).replace(/^`+|`+$/g, '').trim();
}

/** Why a cron cannot schedule test runs: it is invalid, or it ticks more than once an hour while every run asks the models. */
export function getTestScheduleCronError(cron: string): string | null {
	try {
		const ticks = CronExpressionParser.parse(cron);
		let previousTick = ticks.next().getTime();
		for (let tick = 0; tick < CHECKED_TEST_SCHEDULE_TICKS; tick++) {
			const nextTick = ticks.next().getTime();
			if (nextTick - previousTick < MIN_TEST_SCHEDULE_INTERVAL_MS) {
				return 'Schedule the tests at most once an hour.';
			}
			previousTick = nextTick;
		}
		return null;
	} catch {
		return `Invalid cron expression: ${cron}`;
	}
}
