import { Icon } from 'lucide-react';
import type { IconNode, LucideProps } from 'lucide-react';

/** Lucide `rotate-cw-fading-clock`, added upstream in lucide-react 1.27; inlined until we upgrade past 1.0. */
const ROTATE_CW_FADING_CLOCK_NODE: IconNode = [
	['path', { d: 'M12 3a9.75 9.75 0 0 1 6.74 2.74', key: '1k3kxf' }],
	['path', { d: 'M18.74 5.74 21 8', key: '1eb40o' }],
	['path', { d: 'M21 8V3', key: '1et280' }],
	['path', { d: 'M7.5 19.794c-6-3.464-6-12.124 0-15.588', key: '19r0lp' }],
	['path', { d: 'M7.5 4.206A9 9 0 0 1 12 3', key: 's8r11' }],
	['path', { d: 'M12 7v5l4 2', key: '1fdv2h' }],
	['path', { d: 'M14 20.775A9 9 0 0 1 12 21', key: '184rgu' }],
	['path', { d: 'M19 17.656a9 9 0 0 1-1.5 1.456', key: '7qgp6l' }],
	['path', { d: 'M21 12a9 9 0 0 1-.228 2', key: '1h378y' }],
	['path', { d: 'M21 8h-5', key: 'k0yzmk' }],
];

export function RotateCwFadingClock(props: LucideProps) {
	return <Icon iconNode={ROTATE_CW_FADING_CLOCK_NODE} {...props} />;
}
