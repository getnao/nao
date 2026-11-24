import { useState } from 'react';
import { useIsModifierHeld } from './use-is-modifier-held';

/** Selection mode of a story: toggled from its header, or on for as long as the mod key is held. */
export function useElementSelectionMode() {
	const [isToggled, setIsToggled] = useState(false);
	const isModifierHeld = useIsModifierHeld();
	return [isToggled || isModifierHeld, setIsToggled] as const;
}
