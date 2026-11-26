import { useEffect, useState } from 'react';
import { watchModifierHold } from '@nao/shared/keyboard-shortcut';

/** Whether the platform's mod key (⌘ on Mac, Ctrl elsewhere) is held on its own. */
export function useIsModifierHeld(): boolean {
	const [isHeld, setIsHeld] = useState(false);
	useEffect(() => watchModifierHold(window, setIsHeld), []);
	return isHeld;
}
