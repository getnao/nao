/**
 * Models keep assuming the app-db views store Unix epochs. The database rejects that
 * with a type error that never says what the columns actually are, so spell it out and
 * let the model correct itself instead of retrying the same shape.
 */
const EPOCH_MISUSE =
	/operator does not exist: timestamp.*\b(?:integer|bigint|numeric|double precision)\b|function to_timestamp\(timestamp/i;

const EPOCH_HINT =
	"The timestamp columns on these views are real timestamps, not Unix epochs: filter with `created_at >= now() - interval '30 days'` and bucket with `date_trunc('day', created_at)`.";

export function explainAppDbError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return EPOCH_MISUSE.test(message) ? `${message}. ${EPOCH_HINT}` : message;
}
