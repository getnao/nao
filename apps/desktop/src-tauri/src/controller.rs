use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use url::Url;

use crate::health_monitor;
use crate::navigation::Destination;
use crate::screens::{screen_url, Screen};
use crate::server_info::{check_server, ServerCheckError};
use crate::server_store::{save_server_list, Server, ServerListError};
use crate::server_url::parse_server_origin;
use crate::sign_in::{
    build_session_url, build_sign_in_url, generate_state, LoopbackListener, SignInResult,
    SIGN_IN_TIMEOUT,
};
use crate::state::{lock, AppState, PendingSignIn};

pub const MAIN_WINDOW: &str = "main";

pub fn show_screen(app: &AppHandle, screen: Screen) {
    let state = app.state::<AppState>();
    state.next_view_generation();
    *lock(&state.destination) = Destination::LocalUi;
    navigate_main_window(app, screen_url(&state.local_ui, &screen));
}

pub fn show_server_list(app: &AppHandle) {
    cancel_pending_sign_in(app);
    focus_main_window(app);
    show_screen(app, Screen::Servers);
}

/// Checks that the server is reachable and compatible before loading its UI.
pub fn open_server(app: &AppHandle, server_id: &str) -> Result<(), ServerListError> {
    let server = mark_server_used(app, server_id)?;
    cancel_pending_sign_in(app);
    *lock(&app.state::<AppState>().active_server) = Some(server.clone());
    show_screen(
        app,
        Screen::Connecting {
            server_id: server.id.clone(),
        },
    );

    let app = app.clone();
    tauri::async_runtime::spawn(async move { connect(&app, server).await });
    Ok(())
}

pub fn handle_sign_in_request(app: &AppHandle, error: Option<String>) {
    let Some(server) = lock(&app.state::<AppState>().active_server).clone() else {
        show_screen(app, Screen::Servers);
        return;
    };

    match error {
        Some(error) => show_screen(
            app,
            Screen::SignIn {
                server_id: server.id,
                error: Some(error),
            },
        ),
        None => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = start_sign_in(&app, &server.id).await {
                    log::error!("Could not start the sign-in: {error}");
                }
            });
        }
    }
}

pub async fn start_sign_in(app: &AppHandle, server_id: &str) -> Result<(), String> {
    let server = find_server(app, server_id).ok_or("This server is not in your list.")?;
    let origin = parse_server_origin(&server.url).map_err(|error| error.to_string())?;
    cancel_pending_sign_in(app);

    let listener = LoopbackListener::bind()
        .await
        .map_err(|error| error.to_string())?;
    let expected_state = generate_state();
    let sign_in_url = build_sign_in_url(&origin, listener.port(), &expected_state);
    let (attempt, cancelled) = register_pending_sign_in(app, &server);

    show_screen(
        app,
        Screen::SigningIn {
            server_id: server.id.clone(),
            sign_in_url: sign_in_url.to_string(),
        },
    );
    open_in_browser(app, &sign_in_url);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = listener
            .wait_for_callback(&expected_state, SIGN_IN_TIMEOUT, cancelled)
            .await;
        finish_sign_in(&app, attempt, &server, origin, result);
    });
    Ok(())
}

pub fn cancel_sign_in(app: &AppHandle) {
    show_server_list(app);
}

pub fn open_in_browser(app: &AppHandle, url: &Url) {
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        log::warn!("Could not open {url} in the system browser: {error}");
    }
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn reload_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.reload();
    }
}

pub fn navigate_main_window(app: &AppHandle, url: Url) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if let Err(error) = window.navigate(url) {
            log::error!("Could not navigate the main window: {error}");
        }
    }
}

async fn connect(app: &AppHandle, server: Server) {
    let state = app.state::<AppState>();
    let generation = state.view_generation();
    let result = check_server(&state.http, &server.url).await;
    if state.view_generation() != generation {
        return;
    }

    match result {
        Ok(_) => show_server(app, &server, None),
        Err(ServerCheckError::TooOld { version, minimum }) => show_screen(
            app,
            Screen::TooOld {
                server_id: server.id,
                version,
                minimum,
            },
        ),
        Err(error) => show_screen(
            app,
            Screen::Unreachable {
                server_id: server.id,
                reason: unreachable_reason(&error).to_string(),
            },
        ),
    }
}

fn show_server(app: &AppHandle, server: &Server, target: Option<Url>) {
    let Ok(origin) = parse_server_origin(&server.url) else {
        show_screen(app, Screen::Servers);
        return;
    };

    let state = app.state::<AppState>();
    let generation = state.next_view_generation();
    *lock(&state.active_server) = Some(server.clone());
    *lock(&state.destination) = Destination::Server(origin.clone());
    navigate_main_window(app, target.unwrap_or(origin));
    health_monitor::watch(app.clone(), server.clone(), generation);
}

fn finish_sign_in(
    app: &AppHandle,
    attempt: u64,
    server: &Server,
    origin: Url,
    result: SignInResult,
) {
    if !take_pending_sign_in(app, attempt) {
        return;
    }

    let error = match result {
        SignInResult::Authorized(code) => {
            focus_main_window(app);
            show_server(app, server, Some(build_session_url(&origin, &code)));
            return;
        }
        SignInResult::Cancelled => return,
        SignInResult::Denied(error) => error,
        SignInResult::TimedOut => "timeout".to_string(),
        SignInResult::Failed(error) => {
            log::error!("The sign-in listener failed: {error}");
            "listener_failed".to_string()
        }
    };

    focus_main_window(app);
    show_screen(
        app,
        Screen::SignIn {
            server_id: server.id.clone(),
            error: Some(error),
        },
    );
}

fn register_pending_sign_in(app: &AppHandle, server: &Server) -> (u64, oneshot::Receiver<()>) {
    let state = app.state::<AppState>();
    let attempt = state.next_sign_in_attempt();
    let (cancel, cancelled) = oneshot::channel();
    *lock(&state.sign_in) = Some(PendingSignIn { attempt, cancel });
    *lock(&state.active_server) = Some(server.clone());
    (attempt, cancelled)
}

fn take_pending_sign_in(app: &AppHandle, attempt: u64) -> bool {
    let state = app.state::<AppState>();
    let mut pending = lock(&state.sign_in);
    if pending.as_ref().map(|pending| pending.attempt) != Some(attempt) {
        return false;
    }
    *pending = None;
    true
}

fn cancel_pending_sign_in(app: &AppHandle) {
    let pending = lock(&app.state::<AppState>().sign_in).take();
    if let Some(pending) = pending {
        let _ = pending.cancel.send(());
    }
}

fn mark_server_used(app: &AppHandle, server_id: &str) -> Result<Server, ServerListError> {
    let state = app.state::<AppState>();
    let mut servers = lock(&state.servers);
    let server = servers.mark_used(server_id, now_ms())?;
    if let Err(error) = save_server_list(app, &servers) {
        log::error!("Could not save the server list: {error}");
    }
    Ok(server)
}

fn find_server(app: &AppHandle, server_id: &str) -> Option<Server> {
    lock(&app.state::<AppState>().servers)
        .find(server_id)
        .cloned()
}

fn unreachable_reason(error: &ServerCheckError) -> &'static str {
    match error {
        ServerCheckError::InvalidTls => "invalid_tls",
        ServerCheckError::NotNao => "not_nao",
        _ => "unreachable",
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
