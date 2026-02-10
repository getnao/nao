export const randomValues = (minInclusive: number, maxExclusive: number, n: number, unique = false) => {
	const range = maxExclusive - minInclusive;

	if (unique) {
		if (n > range) {
			throw new Error(`Cannot pick ${n} unique values from a range of ${range}`);
		}
		// Fisher-Yates shuffle on indices
		const pool = Array.from({ length: range }, (_, idx) => minInclusive + idx);
		for (let i = pool.length - 1; i > pool.length - 1 - n && i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[pool[i], pool[j]] = [pool[j], pool[i]];
		}
		return pool.slice(pool.length - n);
	}

	return Array.from({ length: n }, () => Math.floor(Math.random() * range) + minInclusive);
};

export const pickUniqueFrom = <T>(array: T[], n: number) => {
	return randomValues(0, array.length, n, true).map((idx) => array[idx]);
};

export const createId = () => {
	return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};
