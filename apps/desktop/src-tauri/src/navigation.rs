use url::Url;

const SIGN_IN_PATHS: [&str; 2] = ["/login", "/signup"];
const IN_PAGE_SCHEMES: [&str; 3] = ["about", "blob", "data"];
const EXTERNAL_SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

/// What the main webview is expected to show. Only Rust changes it, right before it navigates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Destination {
    LocalUi,
    Server(Url),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NavigationDecision {
    Allow,
    Block,
    SignIn { error: Option<String> },
    OpenExternally,
}

/// Decides what happens when the main webview (or a frame inside it) is about to load `target`.
/// Server pages can never navigate to the bundled UI, which is the only content with IPC access.
pub fn decide_navigation(
    target: &Url,
    local_ui: &Url,
    destination: &Destination,
) -> NavigationDecision {
    if IN_PAGE_SCHEMES.contains(&target.scheme()) {
        return NavigationDecision::Allow;
    }

    if is_same_origin(target, local_ui) {
        return match destination {
            Destination::LocalUi => NavigationDecision::Allow,
            Destination::Server(_) => NavigationDecision::Block,
        };
    }

    if let Destination::Server(server) = destination {
        if is_same_origin(target, server) {
            return decide_server_navigation(target);
        }
    }

    if EXTERNAL_SCHEMES.contains(&target.scheme()) {
        NavigationDecision::OpenExternally
    } else {
        NavigationDecision::Block
    }
}

/// Compares scheme, host and port, which also works for custom schemes such as `tauri://localhost`
/// whose `Url::origin()` is opaque.
pub fn is_same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn decide_server_navigation(target: &Url) -> NavigationDecision {
    if !SIGN_IN_PATHS.contains(&target.path().trim_end_matches('/')) {
        return NavigationDecision::Allow;
    }

    let error = target
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.into_owned());
    NavigationDecision::SignIn { error }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    fn local_ui() -> Url {
        url("tauri://localhost/")
    }

    fn on_server() -> Destination {
        Destination::Server(url("https://nao.example.com"))
    }

    fn decide(target: &str, destination: &Destination) -> NavigationDecision {
        decide_navigation(&url(target), &local_ui(), destination)
    }

    #[test]
    fn allows_same_origin_navigation_on_the_server() {
        assert_eq!(
            decide("https://nao.example.com/", &on_server()),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide("https://nao.example.com/chat/123?tab=sql", &on_server()),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide(
                "https://nao.example.com/api/desktop-auth/session?code=abc",
                &on_server()
            ),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn sends_login_and_signup_pages_to_the_browser_sign_in() {
        let sign_in = NavigationDecision::SignIn { error: None };
        assert_eq!(
            decide("https://nao.example.com/login", &on_server()),
            sign_in
        );
        assert_eq!(
            decide("https://nao.example.com/login/", &on_server()),
            sign_in
        );
        assert_eq!(
            decide(
                "https://nao.example.com/login?redirect=%2Fchat",
                &on_server()
            ),
            sign_in
        );
        assert_eq!(
            decide("https://nao.example.com/signup", &on_server()),
            sign_in
        );
    }

    #[test]
    fn forwards_the_login_error_to_the_sign_in_screen() {
        assert_eq!(
            decide(
                "https://nao.example.com/login?error=desktop_auth_expired",
                &on_server()
            ),
            NavigationDecision::SignIn {
                error: Some("desktop_auth_expired".into())
            }
        );
    }

    #[test]
    fn does_not_treat_other_paths_starting_with_login_as_sign_in() {
        assert_eq!(
            decide("https://nao.example.com/login-help", &on_server()),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide("https://nao.example.com/cli-login", &on_server()),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn opens_other_origins_in_the_system_browser() {
        let external = NavigationDecision::OpenExternally;
        assert_eq!(decide("https://docs.getnao.io/", &on_server()), external);
        assert_eq!(
            decide("https://accounts.google.com/o/oauth2/auth", &on_server()),
            external
        );
        assert_eq!(decide("http://nao.example.com/", &on_server()), external);
        assert_eq!(
            decide("https://nao.example.com:8443/", &on_server()),
            external
        );
        assert_eq!(
            decide("https://evil.nao.example.com/", &on_server()),
            external
        );
        assert_eq!(decide("mailto:support@getnao.io", &on_server()), external);
    }

    #[test]
    fn blocks_server_pages_from_navigating_to_the_bundled_ui() {
        assert_eq!(
            decide("tauri://localhost/#/", &on_server()),
            NavigationDecision::Block
        );
        assert_eq!(
            decide("tauri://localhost/index.html", &on_server()),
            NavigationDecision::Block
        );
    }

    #[test]
    fn blocks_unknown_schemes() {
        assert_eq!(
            decide("file:///etc/passwd", &on_server()),
            NavigationDecision::Block
        );
        assert_eq!(
            decide("smb://share/file", &on_server()),
            NavigationDecision::Block
        );
        assert_eq!(
            decide("vscode://open", &Destination::LocalUi),
            NavigationDecision::Block
        );
    }

    #[test]
    fn allows_in_page_content_such_as_srcdoc_frames_and_blob_downloads() {
        assert_eq!(
            decide("about:blank", &on_server()),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide("about:srcdoc", &on_server()),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide("blob:https://nao.example.com/1d4b4c2e", &on_server()),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide("data:image/png;base64,AAAA", &on_server()),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn allows_the_bundled_ui_while_it_is_shown() {
        assert_eq!(
            decide("tauri://localhost/#/servers", &Destination::LocalUi),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn opens_links_from_the_bundled_ui_in_the_system_browser() {
        assert_eq!(
            decide("https://docs.getnao.io/", &Destination::LocalUi),
            NavigationDecision::OpenExternally
        );
    }

    #[test]
    fn treats_the_dev_server_as_the_bundled_ui() {
        let dev_ui = url("http://localhost:1420/");
        assert_eq!(
            decide_navigation(
                &url("http://localhost:1420/#/add"),
                &dev_ui,
                &Destination::LocalUi
            ),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide_navigation(
                &url("http://localhost:5005/"),
                &dev_ui,
                &Destination::Server(url("http://localhost:5005"))
            ),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn compares_origins_including_custom_schemes_and_default_ports() {
        assert!(is_same_origin(
            &url("tauri://localhost/a"),
            &url("tauri://localhost/b")
        ));
        assert!(is_same_origin(
            &url("https://a.com:443/"),
            &url("https://a.com/x")
        ));
        assert!(!is_same_origin(
            &url("https://a.com/"),
            &url("http://a.com/")
        ));
        assert!(!is_same_origin(
            &url("http://localhost:5005/"),
            &url("http://localhost:1420/")
        ));
    }
}
