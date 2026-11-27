use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

use crate::controller::focus_main_window;
use crate::menu::{handle_menu_event, switch_server_item};

const SHOW_WINDOW: &str = "show-window";

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_window = MenuItemBuilder::with_id(SHOW_WINDOW, "Show nao").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_window)
        .item(&switch_server_item(app)?)
        .separator()
        .quit()
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("nao")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_WINDOW => focus_main_window(app),
            id => handle_menu_event(app, id),
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
