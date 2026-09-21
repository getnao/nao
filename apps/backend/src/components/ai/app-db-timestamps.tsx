import dbConfig, { Dialect } from '../../db/dbConfig';
import { Bold, Code, Span } from '../../lib/markdown';

/**
 * How the app-db views expose time. The views normalise the underlying storage
 * so every timestamp column is a real date/time value, but the functions used
 * to slice it still differ per dialect.
 */
export function AppDbTimestamps({ dialect = dbConfig.dialect }: { dialect?: Dialect }) {
	if (dialect === Dialect.Postgres) {
		return (
			<Span>
				Timestamp columns (<Code>created_at</Code>, <Code>called_at</Code>, <Code>superseded_at</Code>) are
				native <Code>timestamp</Code> values, <Bold>not</Bold> Unix epochs, so never wrap them in{' '}
				<Code>to_timestamp()</Code> and never compare them to a number. Filter with{' '}
				<Code>created_at &gt;= now() - interval &apos;30 days&apos;</Code> and bucket with{' '}
				<Code>date_trunc(&apos;day&apos;, created_at)</Code>.
			</Span>
		);
	}
	return (
		<Span>
			Timestamp columns (<Code>created_at</Code>, <Code>called_at</Code>, <Code>superseded_at</Code>) are UTC
			datetime strings such as <Code>2024-06-23 08:15:00</Code>, <Bold>not</Bold> Unix epochs, so never compare
			them to a number and never use <Code>unixepoch</Code>. Filter with{' '}
			<Code>created_at &gt;= datetime(&apos;now&apos;, &apos;-30 days&apos;)</Code> and bucket with{' '}
			<Code>date(created_at)</Code> or <Code>strftime(&apos;%Y-%m&apos;, created_at)</Code>.
		</Span>
	);
}
