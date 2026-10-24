use std::io;
use std::net::Ipv4Addr;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use url::Url;

use crate::random::random_hex;

pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_HEAD_BYTES: usize = 8 * 1024;
const MAX_CODE_LENGTH: usize = 128;
const STATE_BYTES: usize = 32;

const AUTHORIZED_PAGE: &str = include_str!("pages/sign-in-complete.html");
const DENIED_PAGE: &str = include_str!("pages/sign-in-denied.html");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallbackOutcome {
    Authorized(String),
    Denied(String),
    Ignored,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignInResult {
    Authorized(String),
    Denied(String),
    TimedOut,
    Cancelled,
    Failed(String),
}

/// One-shot HTTP listener on 127.0.0.1 that waits for the browser to be redirected to
/// `/callback?code=&state=` after the user approves the sign-in.
pub struct LoopbackListener {
    listener: TcpListener,
}

impl LoopbackListener {
    pub async fn bind() -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        Ok(Self { listener })
    }

    pub fn port(&self) -> u16 {
        self.listener
            .local_addr()
            .map(|address| address.port())
            .unwrap_or_default()
    }

    pub async fn wait_for_callback(
        self,
        expected_state: &str,
        timeout: Duration,
        cancel: oneshot::Receiver<()>,
    ) -> SignInResult {
        tokio::select! {
            result = tokio::time::timeout(timeout, self.accept_until_callback(expected_state)) => {
                result.unwrap_or(SignInResult::TimedOut)
            }
            _ = cancel => SignInResult::Cancelled,
        }
    }

    async fn accept_until_callback(&self, expected_state: &str) -> SignInResult {
        loop {
            let stream = match self.listener.accept().await {
                Ok((stream, _)) => stream,
                Err(error) => return SignInResult::Failed(error.to_string()),
            };
            if let Some(result) = answer_connection(stream, expected_state).await {
                return result;
            }
        }
    }
}

pub fn generate_state() -> String {
    random_hex(STATE_BYTES)
}

pub fn build_sign_in_url(server: &Url, port: u16, state: &str) -> Url {
    let mut url = server
        .join("/cli-login")
        .expect("joining an absolute path always succeeds");
    url.query_pairs_mut()
        .append_pair("port", &port.to_string())
        .append_pair("state", state)
        .append_pair("client", "desktop");
    url
}

pub fn build_session_url(server: &Url, code: &str) -> Url {
    let mut url = server
        .join("/api/desktop-auth/session")
        .expect("joining an absolute path always succeeds");
    url.query_pairs_mut().append_pair("code", code);
    url
}

/// Only a `GET /callback` carrying the expected `state` ends the flow; anything else is ignored
/// so that stray or malicious local requests can't complete or cancel a sign-in.
pub fn parse_callback_request(request_head: &str, expected_state: &str) -> CallbackOutcome {
    let Some(url) = parse_request_target(request_head) else {
        return CallbackOutcome::Ignored;
    };
    if url.path() != "/callback" || expected_state.is_empty() {
        return CallbackOutcome::Ignored;
    }
    if first_query_value(&url, "state").as_deref() != Some(expected_state) {
        return CallbackOutcome::Ignored;
    }
    if let Some(error) = first_query_value(&url, "error") {
        return CallbackOutcome::Denied(error);
    }

    match first_query_value(&url, "code") {
        Some(code) if is_valid_code(&code) => CallbackOutcome::Authorized(code),
        _ => CallbackOutcome::Ignored,
    }
}

async fn answer_connection(mut stream: TcpStream, expected_state: &str) -> Option<SignInResult> {
    let request_head = tokio::time::timeout(REQUEST_READ_TIMEOUT, read_request_head(&mut stream))
        .await
        .ok()
        .flatten()?;

    let outcome = parse_callback_request(&request_head, expected_state);
    let response = match outcome {
        CallbackOutcome::Authorized(_) => html_response(AUTHORIZED_PAGE),
        CallbackOutcome::Denied(_) => html_response(DENIED_PAGE),
        CallbackOutcome::Ignored => not_found_response(),
    };
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;

    match outcome {
        CallbackOutcome::Authorized(code) => Some(SignInResult::Authorized(code)),
        CallbackOutcome::Denied(error) => Some(SignInResult::Denied(error)),
        CallbackOutcome::Ignored => None,
    }
}

async fn read_request_head(stream: &mut TcpStream) -> Option<String> {
    let mut head = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !head.windows(4).any(|window| window == b"\r\n\r\n")
        && head.len() < MAX_REQUEST_HEAD_BYTES
    {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            break;
        }
        head.extend_from_slice(&chunk[..read]);
    }
    String::from_utf8(head).ok()
}

fn parse_request_target(request_head: &str) -> Option<Url> {
    let request_line = request_head.lines().next()?;
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return None;
    };
    if !target.starts_with('/') {
        return None;
    }
    Url::parse("http://127.0.0.1").ok()?.join(target).ok()
}

fn first_query_value(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

fn is_valid_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_CODE_LENGTH
        && code.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn html_response(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n\
         Cache-Control: no-store\r\n\
         Referrer-Policy: no-referrer\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    )
}

fn not_found_response() -> String {
    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "expected-state";

    fn request(target: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
    }

    #[test]
    fn accepts_a_callback_with_the_expected_state() {
        assert_eq!(
            parse_callback_request(
                &request("/callback?code=abc_DEF-123&state=expected-state"),
                STATE
            ),
            CallbackOutcome::Authorized("abc_DEF-123".into())
        );
    }

    #[test]
    fn reports_a_denial_with_the_expected_state() {
        assert_eq!(
            parse_callback_request(
                &request("/callback?error=access_denied&state=expected-state"),
                STATE
            ),
            CallbackOutcome::Denied("access_denied".into())
        );
    }

    #[test]
    fn ignores_callbacks_with_a_wrong_or_missing_state() {
        for target in [
            "/callback?code=abc&state=other-state",
            "/callback?code=abc",
            "/callback?code=abc&state=",
            "/callback?error=access_denied&state=other-state",
        ] {
            assert_eq!(
                parse_callback_request(&request(target), STATE),
                CallbackOutcome::Ignored
            );
        }
    }

    #[test]
    fn uses_the_first_value_when_a_parameter_is_repeated() {
        assert_eq!(
            parse_callback_request(
                &request("/callback?state=other&state=expected-state&code=abc"),
                STATE
            ),
            CallbackOutcome::Ignored
        );
    }

    #[test]
    fn ignores_other_paths_methods_and_malformed_requests() {
        assert_eq!(
            parse_callback_request(&request("/favicon.ico"), STATE),
            CallbackOutcome::Ignored
        );
        assert_eq!(
            parse_callback_request(
                &request("/callback/extra?code=abc&state=expected-state"),
                STATE
            ),
            CallbackOutcome::Ignored
        );
        assert_eq!(
            parse_callback_request(
                "POST /callback?code=abc&state=expected-state HTTP/1.1\r\n\r\n",
                STATE
            ),
            CallbackOutcome::Ignored
        );
        assert_eq!(
            parse_callback_request(
                &request("http://evil.example/callback?code=abc&state=expected-state"),
                STATE
            ),
            CallbackOutcome::Ignored
        );
        assert_eq!(parse_callback_request("", STATE), CallbackOutcome::Ignored);
    }

    #[test]
    fn ignores_codes_that_are_empty_too_long_or_contain_unexpected_characters() {
        let long_code = "a".repeat(MAX_CODE_LENGTH + 1);
        for code in ["", "abc%20def", "abc.def", long_code.as_str()] {
            let target = format!("/callback?code={code}&state=expected-state");
            assert_eq!(
                parse_callback_request(&request(&target), STATE),
                CallbackOutcome::Ignored
            );
        }
    }

    #[test]
    fn never_accepts_an_empty_expected_state() {
        assert_eq!(
            parse_callback_request(&request("/callback?code=abc&state="), ""),
            CallbackOutcome::Ignored
        );
    }

    #[test]
    fn generates_long_unpredictable_states() {
        let state = generate_state();
        assert_eq!(state.len(), STATE_BYTES * 2);
        assert_ne!(state, generate_state());
    }

    #[test]
    fn builds_the_browser_sign_in_url() {
        let server = Url::parse("https://nao.example.com").unwrap();
        assert_eq!(
            build_sign_in_url(&server, 51234, "abc").as_str(),
            "https://nao.example.com/cli-login?port=51234&state=abc&client=desktop"
        );
    }

    #[test]
    fn builds_the_session_url() {
        let server = Url::parse("http://localhost:5005").unwrap();
        assert_eq!(
            build_session_url(&server, "the-code").as_str(),
            "http://localhost:5005/api/desktop-auth/session?code=the-code"
        );
    }

    async fn send(port: u16, raw_request: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        stream.write_all(raw_request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn listener_binds_to_the_loopback_interface_only() {
        let listener = LoopbackListener::bind().await.unwrap();
        let address = listener.listener.local_addr().unwrap();
        assert!(address.ip().is_loopback());
        assert_ne!(address.port(), 0);
    }

    #[tokio::test]
    async fn listener_ignores_invalid_requests_and_returns_the_first_valid_callback() {
        let listener = LoopbackListener::bind().await.unwrap();
        let port = listener.port();
        let (_cancel, cancelled) = oneshot::channel();
        let waiting = tokio::spawn(async move {
            listener
                .wait_for_callback(STATE, Duration::from_secs(10), cancelled)
                .await
        });

        let wrong_state = send(port, &request("/callback?code=abc&state=wrong")).await;
        let favicon = send(port, &request("/favicon.ico")).await;
        let valid = send(
            port,
            &request("/callback?code=the-code&state=expected-state"),
        )
        .await;

        assert!(wrong_state.starts_with("HTTP/1.1 404"));
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(valid.starts_with("HTTP/1.1 200"));
        assert!(valid.contains("return to the nao app"));
        assert_eq!(
            waiting.await.unwrap(),
            SignInResult::Authorized("the-code".into())
        );
        assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn listener_reports_a_denial() {
        let listener = LoopbackListener::bind().await.unwrap();
        let port = listener.port();
        let (_cancel, cancelled) = oneshot::channel();
        let waiting = tokio::spawn(async move {
            listener
                .wait_for_callback(STATE, Duration::from_secs(10), cancelled)
                .await
        });

        let response = send(
            port,
            &request("/callback?error=access_denied&state=expected-state"),
        )
        .await;

        assert!(response.starts_with("HTTP/1.1 200"));
        assert_eq!(
            waiting.await.unwrap(),
            SignInResult::Denied("access_denied".into())
        );
    }

    #[tokio::test]
    async fn listener_times_out() {
        let listener = LoopbackListener::bind().await.unwrap();
        let (_cancel, cancelled) = oneshot::channel();

        let result = listener
            .wait_for_callback(STATE, Duration::from_millis(50), cancelled)
            .await;

        assert_eq!(result, SignInResult::TimedOut);
    }

    #[tokio::test]
    async fn listener_can_be_cancelled() {
        let listener = LoopbackListener::bind().await.unwrap();
        let (cancel, cancelled) = oneshot::channel();

        cancel.send(()).unwrap();
        let result = listener
            .wait_for_callback(STATE, Duration::from_secs(10), cancelled)
            .await;

        assert_eq!(result, SignInResult::Cancelled);
    }
}
