use std::error::Error;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::oneshot;

/// Release builds look for a signed update at startup and offer to install it.
pub fn check_for_updates(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = install_available_update(&app).await {
            log::warn!("The update check failed: {error}");
        }
    });
}

async fn install_available_update(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    if !confirm_update(app, &update.version).await {
        return Ok(());
    }

    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}

async fn confirm_update(app: &AppHandle, version: &str) -> bool {
    let (answer, answered) = oneshot::channel();
    app.dialog()
        .message(format!(
            "nao {version} is available. Install it and restart now?"
        ))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and restart".into(),
            "Later".into(),
        ))
        .show(move |confirmed| {
            let _ = answer.send(confirmed);
        });
    answered.await.unwrap_or(false)
}
