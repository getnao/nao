use url::form_urlencoded;
use url::Url;

/// The bundled screens, addressed with hash routes such as `#/unreachable?server=<id>`.
/// The route names and parameters must stay in sync with `src/lib/routes.ts`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Screen {
    Servers,
    Connecting {
        server_id: String,
    },
    SigningIn {
        server_id: String,
        sign_in_url: String,
    },
    SignIn {
        server_id: String,
        error: Option<String>,
    },
    Unreachable {
        server_id: String,
        reason: String,
    },
    TooOld {
        server_id: String,
        version: Option<String>,
        minimum: String,
    },
}

pub fn screen_url(local_ui: &Url, screen: &Screen) -> Url {
    let mut url = local_ui.clone();
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(Some(&screen_fragment(screen)));
    url
}

pub fn screen_fragment(screen: &Screen) -> String {
    let (route, params) = route_and_params(screen);
    let query = encode_params(&params);
    if query.is_empty() {
        format!("/{route}")
    } else {
        format!("/{route}?{query}")
    }
}

fn route_and_params(screen: &Screen) -> (&'static str, Vec<(&'static str, &str)>) {
    match screen {
        Screen::Servers => ("servers", vec![]),
        Screen::Connecting { server_id } => ("connecting", vec![("server", server_id)]),
        Screen::SigningIn {
            server_id,
            sign_in_url,
        } => (
            "signing-in",
            vec![("server", server_id), ("signInUrl", sign_in_url)],
        ),
        Screen::SignIn { server_id, error } => (
            "sign-in",
            [
                ("server", Some(server_id.as_str())),
                ("error", error.as_deref()),
            ]
            .into_iter()
            .filter_map(|(key, value)| value.map(|value| (key, value)))
            .collect(),
        ),
        Screen::Unreachable { server_id, reason } => (
            "unreachable",
            vec![("server", server_id), ("reason", reason)],
        ),
        Screen::TooOld {
            server_id,
            version,
            minimum,
        } => (
            "too-old",
            [
                ("server", Some(server_id.as_str())),
                ("version", version.as_deref()),
                ("minimum", Some(minimum.as_str())),
            ]
            .into_iter()
            .filter_map(|(key, value)| value.map(|value| (key, value)))
            .collect(),
        ),
    }
}

fn encode_params(params: &[(&str, &str)]) -> String {
    form_urlencoded::Serializer::new(String::new())
        .extend_pairs(params.iter())
        .finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_ui() -> Url {
        Url::parse("tauri://localhost/").unwrap()
    }

    #[test]
    fn points_to_the_server_list() {
        assert_eq!(
            screen_url(&local_ui(), &Screen::Servers).as_str(),
            "tauri://localhost/#/servers"
        );
    }

    #[test]
    fn encodes_parameters_in_the_hash() {
        let url = screen_url(
            &local_ui(),
            &Screen::SigningIn {
                server_id: "abc".into(),
                sign_in_url: "https://nao.example.com/cli-login?port=1&state=s&client=desktop"
                    .into(),
            },
        );

        assert_eq!(
            url.fragment().unwrap(),
            "/signing-in?server=abc&signInUrl=https%3A%2F%2Fnao.example.com%2Fcli-login%3Fport%3D1%26state%3Ds%26client%3Ddesktop"
        );
    }

    #[test]
    fn omits_optional_parameters() {
        assert_eq!(
            screen_fragment(&Screen::SignIn {
                server_id: "abc".into(),
                error: None
            }),
            "/sign-in?server=abc"
        );
        assert_eq!(
            screen_fragment(&Screen::TooOld {
                server_id: "abc".into(),
                version: None,
                minimum: "0.3.29".into()
            }),
            "/too-old?server=abc&minimum=0.3.29"
        );
    }

    #[test]
    fn replaces_any_existing_path_and_query_of_the_local_ui_url() {
        let dev_ui = Url::parse("http://localhost:1420/index.html?x=1#/old").unwrap();

        let url = screen_url(
            &dev_ui,
            &Screen::Unreachable {
                server_id: "abc".into(),
                reason: "unreachable".into(),
            },
        );

        assert_eq!(
            url.as_str(),
            "http://localhost:1420/#/unreachable?server=abc&reason=unreachable"
        );
    }
}
