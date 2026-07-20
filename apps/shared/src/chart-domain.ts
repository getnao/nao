export function niceNumber(range: number, round: boolean): number {
	if (range <= 0 || !Number.isFinite(range)) {
		return 1;
	}

	const exponent = Math.floor(Math.log10(range));
	const fraction = range / 10 ** exponent;
	const niceFraction = round ? niceRoundedFraction(fraction) : niceCeilingFraction(fraction);
	return niceFraction * 10 ** exponent;
}

export function computeNiceDomain(dataMin: number, dataMax: number): [number, number] {
	if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
		return [0, 1];
	}

	let min = dataMin;
	let max = dataMax;
	if (dataMin === dataMax) {
		const pad = Math.abs(dataMin) === 0 ? 1 : Math.abs(dataMin) * 0.1;
		min -= pad;
		max += pad;
	}

	const range = niceNumber(max - min, false);
	const tickSpacing = niceNumber(range / 4, true);
	const niceMin = Math.floor(min / tickSpacing) * tickSpacing;
	const niceMax = Math.ceil(max / tickSpacing) * tickSpacing;
	return [niceMin, niceMax];
}

export function collectAxisValues(data: Record<string, unknown>[], dataKeys: string[]): number[] {
	return data.flatMap((row) =>
		dataKeys
			.map((key) => row[key])
			.map(toAxisNumber)
			.filter((value) => value !== undefined),
	);
}

export function collectStackedAxisValues(data: Record<string, unknown>[], dataKeys: string[]): number[] {
	return data.flatMap((row) => {
		const totals = dataKeys.reduce(
			(currentTotals, key) => {
				const value = toAxisNumber(row[key]);
				if (value === undefined) {
					return currentTotals;
				}
				if (value >= 0) {
					return { ...currentTotals, positive: currentTotals.positive + value };
				}
				return { ...currentTotals, negative: currentTotals.negative + value };
			},
			{ negative: 0, positive: 0 },
		);
		return [totals.negative, totals.positive].filter((value) => value !== 0);
	});
}

export function resolveYAxisDomain(
	explicitMin: number | undefined,
	explicitMax: number | undefined,
	values: number[],
	zeroBaseline: boolean,
): [number | 'auto', number | 'auto'] | undefined {
	const hasData = values.length > 0;
	const auto = !zeroBaseline && hasData ? computeNiceDomainFromValues(values) : undefined;
	if (explicitMin === undefined && explicitMax === undefined) {
		return auto;
	}

	const dataLow = hasData ? minOf(values) : undefined;
	const dataHigh = hasData ? maxOf(values) : undefined;

	const lower = explicitMin ?? auto?.[0] ?? (zeroBaseline ? 0 : dataLow);
	const upper = explicitMax ?? auto?.[1] ?? dataHigh;

	const lowerValue: number | 'auto' = lower ?? 'auto';
	const upperValue: number | 'auto' = upper ?? 'auto';

	if (typeof lowerValue === 'number' && typeof upperValue === 'number' && lowerValue >= upperValue) {
		return separateInvertedBounds(lowerValue, upperValue, explicitMin, explicitMax);
	}

	return [lowerValue, upperValue];
}

function computeNiceDomainFromValues(values: number[]): [number, number] {
	return computeNiceDomain(minOf(values), maxOf(values));
}

function minOf(values: number[]): number {
	return values.reduce((currentMin, value) => Math.min(currentMin, value), values[0] ?? 0);
}

function maxOf(values: number[]): number {
	return values.reduce((currentMax, value) => Math.max(currentMax, value), values[0] ?? 0);
}

function toAxisNumber(value: unknown): number | undefined {
	if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
		return undefined;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function separateInvertedBounds(
	lower: number,
	upper: number,
	explicitMin: number | undefined,
	explicitMax: number | undefined,
): [number, number] {
	const gap = Math.max(Math.abs(lower), Math.abs(upper), 1) * 0.1;
	if (explicitMax === undefined) {
		return [lower, lower + gap];
	}
	if (explicitMin === undefined) {
		return [upper - gap, upper];
	}
	return [lower, lower + gap];
}

function niceRoundedFraction(fraction: number): number {
	if (fraction < 1.5) {
		return 1;
	}
	if (fraction < 3) {
		return 2;
	}
	if (fraction < 7) {
		return 5;
	}
	return 10;
}

function niceCeilingFraction(fraction: number): number {
	if (fraction <= 1) {
		return 1;
	}
	if (fraction <= 2) {
		return 2;
	}
	if (fraction <= 5) {
		return 5;
	}
	return 10;
}
