use tauri::menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

use crate::controller::{reload_main_window, show_server_list, MAIN_WINDOW};

pub const SWITCH_SERVER: &str = "switch-server";
pub const RELOAD: &str = "reload";
pub const DEVELOPER_TOOLS: &str = "developer-tools";

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = build_view_menu(app)?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .item(&build_first_menu(app)?)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}

pub fn switch_server_item<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<MenuItem<R>> {
    MenuItemBuilder::with_id(SWITCH_SERVER, "Switch server…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)
}

pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        SWITCH_SERVER => show_server_list(app),
        RELOAD => reload_main_window(app),
        DEVELOPER_TOOLS => open_developer_tools(app),
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn build_first_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "nao")
        .about(None)
        .separator()
        .item(&switch_server_item(app)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

#[cfg(not(target_os = "macos"))]
fn build_first_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "File")
        .item(&switch_server_item(app)?)
        .separator()
        .quit()
        .build()
}

fn build_view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let reload = MenuItemBuilder::with_id(RELOAD, "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let mut view_menu = SubmenuBuilder::new(app, "View").item(&reload);

    if cfg!(debug_assertions) {
        let developer_tools = MenuItemBuilder::with_id(DEVELOPER_TOOLS, "Developer Tools")
            .accelerator("Alt+CmdOrCtrl+I")
            .build(app)?;
        view_menu = view_menu.separator().item(&developer_tools);
    }

    view_menu.separator().fullscreen().build()
}

fn open_developer_tools(app: &AppHandle) {
    #[cfg(debug_assertions)]
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.open_devtools();
    }
    #[cfg(not(debug_assertions))]
    let _ = (app, MAIN_WINDOW);
}
