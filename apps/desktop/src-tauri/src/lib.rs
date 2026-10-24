mod commands;
mod controller;
mod downloads;
mod health_monitor;
mod main_window;
mod menu;
mod navigation;
mod random;
mod screens;
mod server_info;
mod server_store;
mod server_url;
mod sign_in;
mod state;
#[cfg(test)]
mod test_support;
#[cfg(not(target_os = "macos"))]
mod tray;
mod updater;

use std::error::Error;

use tauri::{AppHandle, Config, Manager};
use url::Url;

use crate::screens::Screen;
use crate::server_info::build_http_client;
use crate::server_store::load_server_list;
use crate::state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(menu::build_app_menu)
        .on_menu_event(|app, event| menu::handle_menu_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::select_server,
            commands::start_sign_in,
            commands::cancel_sign_in,
        ])
        .setup(|app| setup(app.handle()))
        .run(tauri::generate_context!())
        .expect("error while running the nao desktop app");
}

fn setup(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let servers = load_server_list(app);
    let last_used = servers.last_used().cloned();
    app.manage(AppState::new(
        local_ui_url(app.config()),
        build_http_client(),
        servers,
    ));

    let initial_screen = match &last_used {
        Some(server) => Screen::Connecting {
            server_id: server.id.clone(),
        },
        None => Screen::Servers,
    };
    main_window::create_main_window(app, &initial_screen)?;
    #[cfg(not(target_os = "macos"))]
    tray::create_tray(app)?;

    if let Some(server) = last_used {
        controller::open_server(app, &server.id)?;
    }
    updater::check_for_updates(app.clone());
    Ok(())
}

/// Where Tauri serves the bundled UI: the Vite dev server in `tauri dev`, the custom protocol otherwise.
fn local_ui_url(config: &Config) -> Url {
    if tauri::is_dev() {
        if let Some(dev_url) = &config.build.dev_url {
            return dev_url.clone();
        }
    }
    let protocol_url = if cfg!(windows) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(protocol_url).expect("the protocol URL is valid")
}
