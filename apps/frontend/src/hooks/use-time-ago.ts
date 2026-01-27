import { useEffect, useState } from 'react';
import { getTimeAgo } from '@/lib/time-ago';

/** Calculate how long ago a timestamp is and update it with a dynamic interval */
export const useTimeAgo = (timestamp: number): ReturnType<typeof getTimeAgo> => {
	const [timeAgo, setTimeAgo] = useState(getTimeAgo(timestamp));

	useEffect(() => {
		let intervalTime = 0;

		if (timeAgo.unit === 'second' || timeAgo.unit === 'minute') {
			intervalTime = 1000 * 60;
		} else if (timeAgo.unit === 'hour') {
			intervalTime = 1000 * 60 * 60;
		} else if (timeAgo.unit === 'day') {
			intervalTime = 1000 * 60 * 60 * 24;
		}
		// Don't need to update for chats older than a week

		if (intervalTime > 0) {
			const timeout = setTimeout(() => {
				setTimeAgo(getTimeAgo(timestamp));
			}, intervalTime);
			return () => clearTimeout(timeout);
		}
	}, [timeAgo, timestamp]);

	return timeAgo;
};
