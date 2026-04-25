import { createFileRoute } from '@tanstack/react-router';
import { NotificationPreferences } from '@/components/settings/notification-preferences';

export const Route = createFileRoute('/_sidebar-layout/settings/notifications')({
	component: NotificationsPage,
});

function NotificationsPage() {
	return <NotificationPreferences />;
}
