use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ServerUrlError {
    #[error("Enter a server URL.")]
    Empty,
    #[error("This doesn't look like a valid URL.")]
    Invalid,
    #[error("Only http:// and https:// URLs are supported.")]
    UnsupportedScheme,
}

/// Turns user input into a server origin such as `https://nao.example.com`:
/// adds `https://` when no scheme is given and drops paths, queries and trailing slashes.
pub fn normalize_server_url(input: &str) -> Result<String, ServerUrlError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ServerUrlError::Empty);
    }

    let parsed = Url::parse(&with_default_scheme(trimmed)).map_err(|_| ServerUrlError::Invalid)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ServerUrlError::UnsupportedScheme);
    }
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err(ServerUrlError::Invalid);
    }

    Ok(parsed.origin().ascii_serialization())
}

pub fn parse_server_origin(origin: &str) -> Result<Url, ServerUrlError> {
    Url::parse(origin).map_err(|_| ServerUrlError::Invalid)
}

pub fn default_server_name(origin: &str) -> String {
    match Url::parse(origin) {
        Ok(url) => match (url.host_str(), url.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_string(),
            _ => origin.to_string(),
        },
        Err(_) => origin.to_string(),
    }
}

fn with_default_scheme(input: &str) -> String {
    if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_https_when_no_scheme_is_given() {
        assert_eq!(
            normalize_server_url("nao.example.com").unwrap(),
            "https://nao.example.com"
        );
    }

    #[test]
    fn keeps_an_explicit_http_scheme() {
        assert_eq!(
            normalize_server_url("http://localhost:5005").unwrap(),
            "http://localhost:5005"
        );
    }

    #[test]
    fn treats_host_and_port_without_scheme_as_https() {
        assert_eq!(
            normalize_server_url("localhost:5005").unwrap(),
            "https://localhost:5005"
        );
    }

    #[test]
    fn trims_whitespace_and_removes_trailing_slashes_paths_and_queries() {
        assert_eq!(
            normalize_server_url("  https://nao.example.com/chat/123/?tab=1#top  ").unwrap(),
            "https://nao.example.com"
        );
        assert_eq!(
            normalize_server_url("https://nao.example.com///").unwrap(),
            "https://nao.example.com"
        );
    }

    #[test]
    fn lowercases_the_host_and_drops_default_ports_and_credentials() {
        assert_eq!(
            normalize_server_url("HTTPS://user:secret@Nao.Example.COM:443").unwrap(),
            "https://nao.example.com"
        );
    }

    #[test]
    fn keeps_non_default_ports_and_ip_addresses() {
        assert_eq!(
            normalize_server_url("https://10.0.0.4:8443/").unwrap(),
            "https://10.0.0.4:8443"
        );
        assert_eq!(
            normalize_server_url("http://[::1]:5005").unwrap(),
            "http://[::1]:5005"
        );
    }

    #[test]
    fn rejects_empty_input() {
        assert_eq!(normalize_server_url("   "), Err(ServerUrlError::Empty));
    }

    #[test]
    fn rejects_unsupported_schemes() {
        assert_eq!(
            normalize_server_url("ftp://nao.example.com"),
            Err(ServerUrlError::UnsupportedScheme)
        );
        assert_eq!(
            normalize_server_url("file:///etc/passwd"),
            Err(ServerUrlError::UnsupportedScheme)
        );
    }

    #[test]
    fn rejects_malformed_urls() {
        assert_eq!(
            normalize_server_url("https://"),
            Err(ServerUrlError::Invalid)
        );
        assert_eq!(
            normalize_server_url("not a url"),
            Err(ServerUrlError::Invalid)
        );
    }

    #[test]
    fn derives_a_display_name_from_the_host() {
        assert_eq!(
            default_server_name("https://nao.example.com"),
            "nao.example.com"
        );
        assert_eq!(
            default_server_name("http://localhost:5005"),
            "localhost:5005"
        );
    }
}
