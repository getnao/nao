import { Database } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

import AwsIcon from '@/components/icons/aws.svg';
import BigQueryIcon from '@/components/icons/bigquery.svg';
import ClickHouseIcon from '@/components/icons/clickhouse.svg';
import DatabricksIcon from '@/components/icons/databricks.svg';
import DuckDbIcon from '@/components/icons/duckdb.svg';
import FabricIcon from '@/components/icons/fabric.svg';
import MotherDuckIcon from '@/components/icons/motherduck.svg';
import MssqlIcon from '@/components/icons/mssql.svg';
import MysqlIcon from '@/components/icons/mysql.svg';
import PostgresIcon from '@/components/icons/postgres.svg';
import RedshiftIcon from '@/components/icons/redshift.svg';
import SnowflakeIcon from '@/components/icons/snowflake.svg';
import StarRocksIcon from '@/components/icons/starrocks.svg';
import TrinoIcon from '@/components/icons/trino.svg';

const DIALECT_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
	athena: AwsIcon,
	bigquery: BigQueryIcon,
	clickhouse: ClickHouseIcon,
	databricks: DatabricksIcon,
	duckdb: DuckDbIcon,
	ducklake: DuckDbIcon,
	fabric: FabricIcon,
	motherduck: MotherDuckIcon,
	mssql: MssqlIcon,
	mysql: MysqlIcon,
	postgres: PostgresIcon,
	redshift: RedshiftIcon,
	snowflake: SnowflakeIcon,
	starrocks: StarRocksIcon,
	trino: TrinoIcon,
};

interface DatabaseIconProps {
	dialect?: string;
	className?: string;
}

/** The logo of the warehouse a query runs on, or a generic database icon when it has none. */
export function DatabaseIcon({ dialect, className }: DatabaseIconProps) {
	const Icon = (dialect && DIALECT_ICONS[dialect.toLowerCase()]) || Database;
	return <Icon className={className} aria-hidden />;
}
