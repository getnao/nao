import { useCallback, useEffect, useRef, useState } from 'react';

export const useTimedFlag = (duration: number) => {
	const [isActive, setIsActive] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timeoutRef.current), []);

	const activate = useCallback(() => {
		setIsActive(true);
		clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => setIsActive(false), duration);
	}, [duration]);

	return { isActive, activate };
};
