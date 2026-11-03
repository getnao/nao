import { Badge } from '@/components/ui/badge';

export type MemberAccessState = 'viewer' | 'read-only' | 'seated';

export function MemberAccessBadge({ access }: { access: MemberAccessState }) {
	const label = access === 'read-only' ? 'Read-only' : access === 'viewer' ? 'Viewer' : 'Seated';
	return <Badge variant={access === 'seated' ? 'success' : 'secondary'}>{label}</Badge>;
}
