//! Runs chat turns on the user's own Claude Code login through the `nao-agent` sidecar, for the
//! server page shown in the main window. The page reaches it over three IPC commands that only its
//! origin is granted; the sidecar speaks JSON lines on stdin and stdout.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::{CapabilityBuilder, Channel};
use tauri::{AppHandle, Manager, Webview};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use url::Url;

use crate::controller::MAIN_WINDOW;
use crate::navigation::{is_same_origin, Destination};
use crate::random::random_hex;
use crate::state::{lock, AppState};

const SIDECAR_NAME: &str = "nao-agent";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const REQUEST_ID_BYTES: usize = 12;
const SUPPORTED_PROVIDER: &str = "claude";
pub const COMMAND_PERMISSIONS: [&str; 4] = [
    "allow-local-agent-status",
    "allow-local-agent-overview",
    "allow-local-agent-start-turn",
    "allow-local-agent-stop-turn",
];

#[derive(Default)]
pub struct LocalAgent {
    sidecar: AsyncMutex<Option<Sidecar>>,
    pending_requests: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    turns: Mutex<HashMap<String, Channel<Value>>>,
    granted_origins: Mutex<HashSet<String>>,
}

struct Sidecar {
    stdin: ChildStdin,
    _child: Child,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInput {
    provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    prompt: String,
    history: Option<String>,
    system_prompt: String,
    mcp: McpEndpoint,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct McpEndpoint {
    url: String,
    token: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum SidecarMessage {
    Status {
        #[serde(rename = "requestId")]
        request_id: String,
        status: Value,
    },
    Overview {
        #[serde(rename = "requestId")]
        request_id: String,
        overview: Value,
    },
    TurnEvent {
        #[serde(rename = "turnId")]
        turn_id: String,
        event: Value,
    },
}

#[tauri::command]
pub async fn local_agent_status(
    app: AppHandle,
    webview: Webview,
    refresh: Option<bool>,
) -> Result<Value, String> {
    caller_server(&app, &webview)?;
    let request = json!({ "type": "status", "refresh": refresh.unwrap_or(false) });
    app.state::<LocalAgent>().ask(&app, request).await
}

/// The plan limits and the usage of the turns run for the calling server, which is the only one
/// whose turns it sees.
#[tauri::command]
pub async fn local_agent_overview(app: AppHandle, webview: Webview) -> Result<Value, String> {
    let server = caller_server(&app, &webview)?;
    let request =
        json!({ "type": "overview", "serverOrigin": server.origin().ascii_serialization() });
    app.state::<LocalAgent>().ask(&app, request).await
}

#[tauri::command]
pub async fn local_agent_start_turn(
    app: AppHandle,
    webview: Webview,
    turn: TurnInput,
    on_event: Channel<Value>,
) -> Result<String, String> {
    let server = caller_server(&app, &webview)?;
    validate_turn(&turn, &server)?;
    let agent = app.state::<LocalAgent>();
    let turn_id = random_hex(REQUEST_ID_BYTES);
    lock(&agent.turns).insert(turn_id.clone(), on_event);
    let request = json!({ "type": "turn", "turnId": turn_id, "turn": turn });
    if let Err(error) = agent.send(&app, &request).await {
        lock(&agent.turns).remove(&turn_id);
        return Err(error);
    }
    Ok(turn_id)
}

#[tauri::command]
pub async fn local_agent_stop_turn(
    app: AppHandle,
    webview: Webview,
    turn_id: String,
) -> Result<(), String> {
    caller_server(&app, &webview)?;
    let agent = app.state::<LocalAgent>();
    if !lock(&agent.turns).contains_key(&turn_id) {
        return Ok(());
    }
    agent
        .send(&app, &json!({ "type": "stop", "turnId": turn_id }))
        .await
}

/// Lets the pages of a server call the local agent commands. Server origins are otherwise untrusted
/// and have no IPC access; this grants nothing else.
pub fn allow_server_origin(app: &AppHandle, origin: &Url) {
    let agent = app.state::<LocalAgent>();
    let pattern = remote_pattern(origin);
    if !lock(&agent.granted_origins).insert(pattern.clone()) {
        return;
    }
    let capability = COMMAND_PERMISSIONS.iter().fold(
        CapabilityBuilder::new(format!("local-agent-{}", random_hex(REQUEST_ID_BYTES)))
            .remote(pattern.clone())
            .local(false)
            .window(MAIN_WINDOW),
        |builder, permission| builder.permission(*permission),
    );
    if let Err(error) = app.add_capability(capability) {
        lock(&agent.granted_origins).remove(&pattern);
        log::error!("Could not let {origin} use the local agent: {error}");
    }
}

impl LocalAgent {
    async fn ask(&self, app: &AppHandle, mut request: Value) -> Result<Value, String> {
        let request_id = random_hex(REQUEST_ID_BYTES);
        request["requestId"] = Value::String(request_id.clone());
        let (sender, receiver) = oneshot::channel();
        lock(&self.pending_requests).insert(request_id.clone(), sender);
        if let Err(error) = self.send(app, &request).await {
            lock(&self.pending_requests).remove(&request_id);
            return Err(error);
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(answer)) => Ok(answer),
            Ok(Err(_)) => Err("The local agent stopped before answering.".into()),
            Err(_) => {
                lock(&self.pending_requests).remove(&request_id);
                Err("The local agent did not answer in time.".into())
            }
        }
    }

    async fn send(&self, app: &AppHandle, request: &Value) -> Result<(), String> {
        let mut line = request.to_string();
        line.push('\n');
        let mut sidecar = self.sidecar.lock().await;
        if sidecar.is_none() {
            *sidecar = Some(spawn_sidecar(app)?);
        }
        let stdin = &mut sidecar
            .as_mut()
            .expect("the sidecar was just started")
            .stdin;
        if let Err(error) = stdin.write_all(line.as_bytes()).await {
            *sidecar = None;
            return Err(format!("Could not reach the local agent: {error}"));
        }
        Ok(())
    }

    fn route(&self, line: &str) {
        match serde_json::from_str::<SidecarMessage>(line) {
            Ok(SidecarMessage::Status { request_id, status }) => self.answer(&request_id, status),
            Ok(SidecarMessage::Overview {
                request_id,
                overview,
            }) => self.answer(&request_id, overview),
            Ok(SidecarMessage::TurnEvent { turn_id, event }) => self.forward(&turn_id, event),
            Err(error) => log::warn!("Ignored a local agent message: {error}"),
        }
    }

    fn answer(&self, request_id: &str, answer: Value) {
        if let Some(sender) = lock(&self.pending_requests).remove(request_id) {
            let _ = sender.send(answer);
        }
    }

    fn forward(&self, turn_id: &str, event: Value) {
        let is_done = event.get("type").and_then(Value::as_str) == Some("done");
        let mut turns = lock(&self.turns);
        if let Some(channel) = turns.get(turn_id) {
            if channel.send(event).is_err() || is_done {
                turns.remove(turn_id);
            }
        }
    }

    /// The sidecar exited: every running turn ends with an error, and the next request starts it again.
    async fn on_sidecar_exit(&self) {
        *self.sidecar.lock().await = None;
        lock(&self.pending_requests).clear();
        let turns: Vec<_> = lock(&self.turns).drain().collect();
        for (_, channel) in turns {
            let _ = channel.send(json!({
                "type": "done",
                "modelId": "",
                "stopReason": "error",
                "errorMessage": "The local agent stopped unexpectedly.",
            }));
        }
    }
}

fn spawn_sidecar(app: &AppHandle) -> Result<Sidecar, String> {
    let workspace = workspace_directory(app)?;
    let mut child = Command::new(sidecar_path()?)
        .current_dir(&workspace)
        .env("NAO_AGENT_WORKSPACE", &workspace)
        .env("NAO_AGENT_DATA_DIR", data_directory(app)?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Could not start the local agent: {error}"))?;
    let stdin = child.stdin.take().ok_or("The local agent has no stdin.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("The local agent has no stdout.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("The local agent has no stderr.")?;

    let reader_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            reader_app.state::<LocalAgent>().route(&line);
        }
        reader_app.state::<LocalAgent>().on_sidecar_exit().await;
    });
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("nao-agent: {line}");
        }
    });
    Ok(Sidecar {
        stdin,
        _child: child,
    })
}

/// Tauri bundles `externalBin` binaries next to the app executable, without the target triple.
fn sidecar_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = executable
        .parent()
        .ok_or("The app executable has no directory.")?;
    let name = if cfg!(windows) {
        format!("{SIDECAR_NAME}.exe")
    } else {
        SIDECAR_NAME.to_string()
    };
    Ok(directory.join(name))
}

/// Holds the usage ledger of the turns run through nao, which nao itself never stores.
fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("local-agent");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn workspace_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("agent-workspace");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

/// Only the server page shown in the main window may use the local agent.
fn caller_server(app: &AppHandle, webview: &Webview) -> Result<Url, String> {
    let Destination::Server(server) = lock(&app.state::<AppState>().destination).clone() else {
        return Err("The local agent is only available on a server page.".into());
    };
    let page = webview.url().map_err(|error| error.to_string())?;
    if !is_same_origin(&page, &server) {
        return Err("The local agent is only available on the server shown in the app.".into());
    }
    Ok(server)
}

fn validate_turn(turn: &TurnInput, server: &Url) -> Result<(), String> {
    if turn.provider != SUPPORTED_PROVIDER {
        return Err(format!(
            "Unsupported local agent provider: {}",
            turn.provider
        ));
    }
    let tools_url = Url::parse(&turn.mcp.url).map_err(|_| "The nao tools URL is not valid.")?;
    if !matches!(tools_url.scheme(), "http" | "https") || !is_same_origin(&tools_url, server) {
        return Err("The nao tools must come from the server shown in the app.".into());
    }
    Ok(())
}

fn remote_pattern(origin: &Url) -> String {
    format!("{}/*", origin.as_str().trim_end_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(tools_url: &str) -> TurnInput {
        TurnInput {
            provider: "claude".into(),
            model: None,
            prompt: "How many orders?".into(),
            history: None,
            system_prompt: "You are nao.".into(),
            mcp: McpEndpoint {
                url: tools_url.into(),
                token: "nao_local_token".into(),
            },
        }
    }

    fn server() -> Url {
        Url::parse("https://nao.example.com/").unwrap()
    }

    #[test]
    fn accepts_tools_on_the_server_shown_in_the_app() {
        assert!(validate_turn(
            &turn("https://nao.example.com/api/local-agent/mcp"),
            &server()
        )
        .is_ok());
    }

    #[test]
    fn refuses_tools_on_another_origin_or_scheme() {
        assert!(validate_turn(&turn("https://evil.example.com/mcp"), &server()).is_err());
        assert!(validate_turn(&turn("http://nao.example.com/mcp"), &server()).is_err());
        assert!(validate_turn(&turn("file:///etc/passwd"), &server()).is_err());
        assert!(validate_turn(&turn("not a url"), &server()).is_err());
    }

    #[test]
    fn refuses_unknown_providers() {
        let mut codex = turn("https://nao.example.com/api/local-agent/mcp");
        codex.provider = "codex".into();
        assert!(validate_turn(&codex, &server()).is_err());
    }

    #[test]
    fn grants_every_path_of_the_server_origin() {
        assert_eq!(remote_pattern(&server()), "https://nao.example.com/*");
        assert_eq!(
            remote_pattern(&Url::parse("http://localhost:5005").unwrap()),
            "http://localhost:5005/*"
        );
    }

    #[test]
    fn sends_the_turn_to_the_sidecar_in_camel_case() {
        let value =
            serde_json::to_value(turn("https://nao.example.com/api/local-agent/mcp")).unwrap();
        assert_eq!(value["systemPrompt"], "You are nao.");
        assert_eq!(value["mcp"]["token"], "nao_local_token");
        assert!(value.get("model").is_none());
    }
}
