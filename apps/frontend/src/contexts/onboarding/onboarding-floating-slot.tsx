import { createSlotContext } from '@/contexts/create-slot-context';

const { SlotProvider, Slot, SlotContent } = createSlotContext();

/** Pins onboarding cards that scrolled out of view to the top of the onboarding conversation. */
export const OnboardingFloatingSlotProvider = SlotProvider;
export const OnboardingFloatingSlot = Slot;
export const OnboardingFloatingContent = SlotContent;
