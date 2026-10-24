import { useRoute } from '@/hooks/use-route';
import { useServers } from '@/hooks/use-servers';
import { routeHash } from '@/lib/routes';
import { findServer } from '@/lib/servers';
import { AddServer } from '@/screens/add-server';
import { Connecting } from '@/screens/connecting';
import { ServerPicker } from '@/screens/server-picker';
import { ServerTooOld } from '@/screens/server-too-old';
import { ServerUnreachable } from '@/screens/server-unreachable';
import { SignIn } from '@/screens/sign-in';
import { SigningIn } from '@/screens/signing-in';

export function App() {
	const route = useRoute();
	const { servers, error, reload } = useServers(routeHash(route));

	switch (route.name) {
		case 'servers':
			return <ServerPicker servers={servers} loadError={error} onServersChanged={reload} />;
		case 'add-server':
			return <AddServer />;
		case 'connecting':
			return <Connecting server={findServer(servers, route.serverId)} />;
		case 'signing-in':
			return <SigningIn server={findServer(servers, route.serverId)} signInUrl={route.signInUrl} />;
		case 'sign-in':
			return (
				<SignIn serverId={route.serverId} server={findServer(servers, route.serverId)} error={route.error} />
			);
		case 'unreachable':
			return (
				<ServerUnreachable
					serverId={route.serverId}
					server={findServer(servers, route.serverId)}
					reason={route.reason}
				/>
			);
		case 'too-old':
			return (
				<ServerTooOld
					serverId={route.serverId}
					server={findServer(servers, route.serverId)}
					version={route.version}
					minimum={route.minimum}
				/>
			);
	}
}
