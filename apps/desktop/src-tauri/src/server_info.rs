use std::error::Error;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// The first nao server release that exposes `/api/server-info` and `/api/desktop-auth/session`.
pub const MIN_SERVER_VERSION: &str = "0.3.29";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const LEGACY_API_GREETING: &str = "Welcome to the API!";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ServerInfo {
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ServerCheckError {
    #[error("The server could not be reached.")]
    Unreachable,
    #[error("This is not a nao server.")]
    NotNao,
    #[error("This nao server is too old for the desktop app.")]
    TooOld {
        version: Option<String>,
        minimum: String,
    },
    #[error("The server's TLS certificate is not valid.")]
    InvalidTls,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ServerInfoVerdict {
    Supported(ServerInfo),
    Rejected(ServerCheckError),
    EndpointMissing,
}

#[derive(Deserialize)]
struct ServerInfoBody {
    app: String,
    version: String,
}

pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("nao-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("the HTTP client configuration is static and valid")
}

pub async fn check_server(
    client: &reqwest::Client,
    origin: &str,
) -> Result<ServerInfo, ServerCheckError> {
    let (status, body) = fetch_text(client, &format!("{origin}/api/server-info")).await?;
    match evaluate_server_info(status, &body, MIN_SERVER_VERSION) {
        ServerInfoVerdict::Supported(info) => Ok(info),
        ServerInfoVerdict::Rejected(error) => Err(error),
        ServerInfoVerdict::EndpointMissing => Err(probe_legacy_server(client, origin).await),
    }
}

pub async fn is_server_healthy(client: &reqwest::Client, origin: &str) -> bool {
    match client.get(format!("{origin}/api/health")).send().await {
        Ok(response) => !response.status().is_server_error(),
        Err(_) => false,
    }
}

pub fn evaluate_server_info(status: u16, body: &str, minimum: &str) -> ServerInfoVerdict {
    if status == 404 {
        return ServerInfoVerdict::EndpointMissing;
    }
    if status >= 500 {
        return ServerInfoVerdict::Rejected(ServerCheckError::Unreachable);
    }
    if !(200..300).contains(&status) {
        return ServerInfoVerdict::Rejected(ServerCheckError::NotNao);
    }

    let Ok(info) = serde_json::from_str::<ServerInfoBody>(body) else {
        return ServerInfoVerdict::Rejected(ServerCheckError::NotNao);
    };
    if info.app != "nao" {
        return ServerInfoVerdict::Rejected(ServerCheckError::NotNao);
    }
    if !is_supported_version(&info.version, minimum) {
        return ServerInfoVerdict::Rejected(ServerCheckError::TooOld {
            version: Some(info.version),
            minimum: minimum.to_string(),
        });
    }

    ServerInfoVerdict::Supported(ServerInfo {
        version: info.version,
    })
}

/// Versions that don't start with a number (`dev`, `main`, preview names) come from rolling builds of
/// the main branch, which always include the desktop endpoints.
pub fn is_supported_version(version: &str, minimum: &str) -> bool {
    match (parse_version(version), parse_version(minimum)) {
        (Some(version), Some(minimum)) => version >= minimum,
        _ => true,
    }
}

pub fn parse_version(version: &str) -> Option<[u64; 3]> {
    let mut parts = [0u64; 3];
    let segments = version.trim().trim_start_matches('v').split('.');

    for (index, segment) in segments.take(3).enumerate() {
        let digits: String = segment.chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() {
            if index == 0 {
                return None;
            }
            break;
        }
        parts[index] = digits.parse().ok()?;
        if digits.len() != segment.len() {
            break;
        }
    }

    Some(parts)
}

pub fn is_legacy_nao_api(status: u16, body: &str) -> bool {
    status == 200 && body.contains(LEGACY_API_GREETING)
}

pub fn classify_transport_error(error: &(dyn Error + 'static)) -> ServerCheckError {
    if mentions_certificate_problem(&error_chain_messages(error)) {
        ServerCheckError::InvalidTls
    } else {
        ServerCheckError::Unreachable
    }
}

pub fn mentions_certificate_problem(messages: &[String]) -> bool {
    messages.iter().any(|message| {
        let message = message.to_lowercase();
        message.contains("certificate")
            || message.contains("unknownissuer")
            || message.contains("self signed")
    })
}

async fn probe_legacy_server(client: &reqwest::Client, origin: &str) -> ServerCheckError {
    match fetch_text(client, &format!("{origin}/api")).await {
        Ok((status, body)) if is_legacy_nao_api(status, &body) => ServerCheckError::TooOld {
            version: None,
            minimum: MIN_SERVER_VERSION.to_string(),
        },
        Ok(_) => ServerCheckError::NotNao,
        Err(error) => error,
    }
}

async fn fetch_text(
    client: &reqwest::Client,
    url: &str,
) -> Result<(u16, String), ServerCheckError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| classify_transport_error(&error))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| classify_transport_error(&error))?;
    Ok((status, body))
}

fn error_chain_messages(error: &(dyn Error + 'static)) -> Vec<String> {
    let mut messages = Vec::new();
    let mut current = Some(error);
    while let Some(error) = current {
        messages.push(format!("{error} {error:?}"));
        current = error.source();
    }
    messages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::StubHttpServer;

    const MINIMUM: &str = "0.3.29";

    #[test]
    fn accepts_a_nao_server_at_or_above_the_minimum_version() {
        assert_eq!(
            evaluate_server_info(200, r#"{"app":"nao","version":"0.3.29"}"#, MINIMUM),
            ServerInfoVerdict::Supported(ServerInfo {
                version: "0.3.29".into()
            })
        );
        assert!(matches!(
            evaluate_server_info(200, r#"{"app":"nao","version":"1.0.0"}"#, MINIMUM),
            ServerInfoVerdict::Supported(_)
        ));
    }

    #[test]
    fn rejects_a_nao_server_below_the_minimum_version() {
        assert_eq!(
            evaluate_server_info(200, r#"{"app":"nao","version":"0.3.28"}"#, MINIMUM),
            ServerInfoVerdict::Rejected(ServerCheckError::TooOld {
                version: Some("0.3.28".into()),
                minimum: MINIMUM.into(),
            })
        );
    }

    #[test]
    fn accepts_rolling_builds_without_a_numeric_version() {
        assert!(matches!(
            evaluate_server_info(200, r#"{"app":"nao","version":"dev"}"#, MINIMUM),
            ServerInfoVerdict::Supported(_)
        ));
    }

    #[test]
    fn rejects_responses_that_are_not_from_nao() {
        let rejected = ServerInfoVerdict::Rejected(ServerCheckError::NotNao);
        assert_eq!(
            evaluate_server_info(200, r#"{"app":"other","version":"1.0.0"}"#, MINIMUM),
            rejected
        );
        assert_eq!(
            evaluate_server_info(200, "<!doctype html><html></html>", MINIMUM),
            rejected
        );
        assert_eq!(
            evaluate_server_info(200, r#"{"version":"1.0.0"}"#, MINIMUM),
            rejected
        );
        assert_eq!(evaluate_server_info(401, "", MINIMUM), rejected);
    }

    #[test]
    fn reports_a_missing_endpoint_and_server_errors() {
        assert_eq!(
            evaluate_server_info(404, "", MINIMUM),
            ServerInfoVerdict::EndpointMissing
        );
        assert_eq!(
            evaluate_server_info(502, "Bad gateway", MINIMUM),
            ServerInfoVerdict::Rejected(ServerCheckError::Unreachable)
        );
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(is_supported_version("0.3.30", "0.3.29"));
        assert!(is_supported_version("0.10.0", "0.9.99"));
        assert!(is_supported_version("v0.3.29", "0.3.29"));
        assert!(!is_supported_version("0.3.9", "0.3.29"));
        assert!(!is_supported_version("0.2.100", "0.3.0"));
    }

    #[test]
    fn parses_versions_with_suffixes_and_missing_parts() {
        assert_eq!(parse_version("0.3.29"), Some([0, 3, 29]));
        assert_eq!(parse_version("0.3.29rc1"), Some([0, 3, 29]));
        assert_eq!(parse_version("0.3.29.dev4"), Some([0, 3, 29]));
        assert_eq!(parse_version("1.2"), Some([1, 2, 0]));
        assert_eq!(parse_version("2"), Some([2, 0, 0]));
        assert_eq!(parse_version("dev"), None);
        assert_eq!(parse_version("main"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn recognises_the_legacy_nao_api_greeting() {
        assert!(is_legacy_nao_api(200, "Welcome to the API!"));
        assert!(!is_legacy_nao_api(200, "<html>Welcome</html>"));
        assert!(!is_legacy_nao_api(404, "Welcome to the API!"));
    }

    #[test]
    fn detects_certificate_problems_in_error_messages() {
        assert!(mentions_certificate_problem(&[
            "invalid peer certificate: UnknownIssuer".into()
        ]));
        assert!(mentions_certificate_problem(&[
            "InvalidCertificate(Expired)".into()
        ]));
        assert!(!mentions_certificate_problem(&[
            "Connection refused (os error 111)".into()
        ]));
    }

    #[tokio::test]
    async fn check_server_accepts_a_supported_nao_server() {
        let server = StubHttpServer::start(|path| match path {
            "/api/server-info" => (200, r#"{"app":"nao","version":"0.4.0"}"#.into()),
            _ => (404, String::new()),
        })
        .await;

        let info = check_server(&build_http_client(), &server.origin())
            .await
            .unwrap();

        assert_eq!(info.version, "0.4.0");
    }

    #[tokio::test]
    async fn check_server_reports_old_nao_servers_without_the_endpoint_as_too_old() {
        let server = StubHttpServer::start(|path| match path {
            "/api" => (200, "Welcome to the API!".into()),
            _ => (404, r#"{"error":"Not found"}"#.into()),
        })
        .await;

        let error = check_server(&build_http_client(), &server.origin())
            .await
            .unwrap_err();

        assert_eq!(
            error,
            ServerCheckError::TooOld {
                version: None,
                minimum: MIN_SERVER_VERSION.into()
            }
        );
    }

    #[tokio::test]
    async fn check_server_reports_other_servers_as_not_nao() {
        let server = StubHttpServer::start(|_| (404, "Not found".into())).await;

        let error = check_server(&build_http_client(), &server.origin())
            .await
            .unwrap_err();

        assert_eq!(error, ServerCheckError::NotNao);
    }

    #[tokio::test]
    async fn check_server_reports_closed_ports_as_unreachable() {
        let origin = StubHttpServer::unused_origin().await;

        let error = check_server(&build_http_client(), &origin)
            .await
            .unwrap_err();

        assert_eq!(error, ServerCheckError::Unreachable);
    }
}
