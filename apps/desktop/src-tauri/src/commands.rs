use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::controller;
use crate::random::random_hex;
use crate::server_info::{check_server, ServerCheckError};
use crate::server_store::{save_server_list, Server, ServerListError};
use crate::server_url::{normalize_server_url, ServerUrlError};
use crate::state::{lock, AppState};

const SERVER_ID_BYTES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandError {
    InvalidUrl {
        message: String,
    },
    Unreachable,
    NotNao,
    TooOld {
        version: Option<String>,
        minimum: String,
    },
    InvalidTls,
    NotFound,
    BuiltIn,
    Internal {
        message: String,
    },
}

#[tauri::command]
pub fn list_servers(app: AppHandle) -> Vec<Server> {
    lock(&app.state::<AppState>().servers).servers().to_vec()
}

#[tauri::command]
pub async fn add_server(
    app: AppHandle,
    url: String,
    name: Option<String>,
) -> Result<Server, CommandError> {
    let origin = normalize_server_url(&url)?;
    let state = app.state::<AppState>();
    check_server(&state.http, &origin).await?;

    let mut servers = lock(&state.servers);
    let server = servers.add(&origin, name.as_deref(), random_hex(SERVER_ID_BYTES));
    save_server_list(&app, &servers).map_err(|message| CommandError::Internal { message })?;
    Ok(server)
}

#[tauri::command]
pub fn remove_server(app: AppHandle, id: String) -> Result<(), CommandError> {
    let state = app.state::<AppState>();
    let mut servers = lock(&state.servers);
    servers.remove(&id)?;
    save_server_list(&app, &servers).map_err(|message| CommandError::Internal { message })
}

#[tauri::command]
pub fn select_server(app: AppHandle, id: String) -> Result<(), CommandError> {
    controller::open_server(&app, &id).map_err(CommandError::from)
}

#[tauri::command]
pub async fn start_sign_in(app: AppHandle, server_id: String) -> Result<(), CommandError> {
    controller::start_sign_in(&app, &server_id)
        .await
        .map_err(|message| CommandError::Internal { message })
}

#[tauri::command]
pub fn cancel_sign_in(app: AppHandle) {
    controller::cancel_sign_in(&app);
}

impl From<ServerUrlError> for CommandError {
    fn from(error: ServerUrlError) -> Self {
        CommandError::InvalidUrl {
            message: error.to_string(),
        }
    }
}

impl From<ServerCheckError> for CommandError {
    fn from(error: ServerCheckError) -> Self {
        match error {
            ServerCheckError::Unreachable => CommandError::Unreachable,
            ServerCheckError::NotNao => CommandError::NotNao,
            ServerCheckError::TooOld { version, minimum } => {
                CommandError::TooOld { version, minimum }
            }
            ServerCheckError::InvalidTls => CommandError::InvalidTls,
        }
    }
}

impl From<ServerListError> for CommandError {
    fn from(error: ServerListError) -> Self {
        match error {
            ServerListError::NotFound => CommandError::NotFound,
            ServerListError::BuiltIn => CommandError::BuiltIn,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_errors_with_a_kind_tag_for_the_bundled_ui() {
        assert_eq!(
            serde_json::to_value(CommandError::from(ServerCheckError::TooOld {
                version: Some("0.3.1".into()),
                minimum: "0.3.29".into(),
            }))
            .unwrap(),
            json!({ "kind": "too_old", "version": "0.3.1", "minimum": "0.3.29" })
        );
        assert_eq!(
            serde_json::to_value(CommandError::from(ServerCheckError::InvalidTls)).unwrap(),
            json!({ "kind": "invalid_tls" })
        );
        assert_eq!(
            serde_json::to_value(CommandError::from(ServerUrlError::Empty)).unwrap(),
            json!({ "kind": "invalid_url", "message": "Enter a server URL." })
        );
        assert_eq!(
            serde_json::to_value(CommandError::from(ServerListError::BuiltIn)).unwrap(),
            json!({ "kind": "built_in" })
        );
    }
}
