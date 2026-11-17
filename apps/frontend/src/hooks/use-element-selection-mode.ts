import { useEffect, useState } from 'react';
import { watchModifierHold } from '@nao/shared/keyboard-shortcut';

/** Selection mode of a story: toggled from its header, or on for as long as the mod key is held. */
export function useElementSelectionMode() {
	const [isToggled, setIsToggled] = useState(false);
	const isModifierHeld = useIsModifierHeld();
	return [isToggled || isModifierHeld, setIsToggled] as const;
}

function useIsModifierHeld(): boolean {
	const [isHeld, setIsHeld] = useState(false);
	useEffect(() => watchModifierHold(window, setIsHeld), []);
	return isHeld;
}
