use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};
use url::Url;

use crate::controller::{
    handle_sign_in_request, navigate_main_window, open_in_browser, MAIN_WINDOW,
};
use crate::downloads::handle_download;
use crate::navigation::{decide_navigation, Destination, NavigationDecision};
use crate::screens::{screen_fragment, Screen};
use crate::state::{lock, AppState};

const SIGN_IN_REDIRECT_SCRIPT: &str = include_str!("scripts/sign-in-redirect.js");

pub fn create_main_window(
    app: &AppHandle,
    initial_screen: &Screen,
) -> tauri::Result<WebviewWindow> {
    let initial_url =
        WebviewUrl::App(format!("index.html#{}", screen_fragment(initial_screen)).into());
    let navigation_app = app.clone();
    let new_window_app = app.clone();

    WebviewWindowBuilder::new(app, MAIN_WINDOW, initial_url)
        .title("nao")
        .inner_size(1280.0, 840.0)
        .min_inner_size(720.0, 520.0)
        .initialization_script(SIGN_IN_REDIRECT_SCRIPT)
        .on_navigation(move |url| on_navigation(&navigation_app, url))
        .on_new_window(move |url, _features| {
            on_new_window(&new_window_app, url);
            NewWindowResponse::Deny
        })
        .on_download(handle_download)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .build()
}

fn on_navigation(app: &AppHandle, url: &Url) -> bool {
    let decision = current_decision(app, url);
    let allowed = decision == NavigationDecision::Allow;
    defer_decision(app, decision, url.clone(), false);
    allowed
}

/// `target=_blank` links and `window.open` follow the same rules as navigations,
/// except that allowed server pages open in the main window instead of a new one.
fn on_new_window(app: &AppHandle, url: Url) {
    let decision = current_decision(app, &url);
    defer_decision(app, decision, url, true);
}

fn current_decision(app: &AppHandle, url: &Url) -> NavigationDecision {
    let state = app.state::<AppState>();
    let destination = lock(&state.destination).clone();
    decide_navigation(url, &state.local_ui, &destination)
}

/// Follow-up work runs outside the navigation callback, which executes inside the webview's
/// policy decision and must return quickly without navigating again.
fn defer_decision(app: &AppHandle, decision: NavigationDecision, url: Url, from_new_window: bool) {
    if decision == NavigationDecision::Allow && !from_new_window {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(
        async move { apply_decision(&app, decision, url, from_new_window) },
    );
}

fn apply_decision(app: &AppHandle, decision: NavigationDecision, url: Url, from_new_window: bool) {
    match decision {
        NavigationDecision::Allow => {
            if from_new_window && is_server_page(app, &url) {
                navigate_main_window(app, url);
            }
        }
        NavigationDecision::Block => log::warn!("Blocked navigation to {url}"),
        NavigationDecision::OpenExternally => open_in_browser(app, &url),
        NavigationDecision::SignIn { error } => handle_sign_in_request(app, error),
    }
}

fn is_server_page(app: &AppHandle, url: &Url) -> bool {
    matches!(
        &*lock(&app.state::<AppState>().destination),
        Destination::Server(_)
    ) && matches!(url.scheme(), "http" | "https")
}
