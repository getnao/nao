import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

interface CallbackContextValue<T extends (...args: any[]) => void> {
	fire: T;
	register: (callback: T) => { dispose: () => void };
}

/** Creates a React context with a callback function and its setter */
export const createCallbackContext = <T extends (...args: any[]) => void>() => {
	const context = createContext<CallbackContextValue<T> | null>(null);

	const Provider = ({ children }: { children: React.ReactNode }) => {
		const callbackRef = useRef<T | null>(null);

		const register = useCallback((callback: T) => {
			callbackRef.current = callback;
			return {
				dispose: () => {
					callbackRef.current = null;
				},
			};
		}, []);

		const fire = useCallback((...args: any[]) => {
			callbackRef.current?.(...args);
		}, []) as T;

		const value = useMemo(() => ({ fire, register }), [fire, register]);

		return <context.Provider value={value}>{children}</context.Provider>;
	};

	/** Utility hook to handle the registration lifecycle of the callback function */
	const useRegister = (callback: T, deps: any[] = []) => {
		const { register } = useContext(context)!;
		useEffect(() => {
			return register(callback).dispose;
		}, deps); // eslint-disable-line
	};

	return {
		Provider,
		useContext: () => useContext(context)!,
		useRegister,
	};
};
