const APP_COMMANDS: &[&str] = &[
    "list_servers",
    "add_server",
    "remove_server",
    "select_server",
    "start_sign_in",
    "cancel_sign_in",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run the tauri build script");
}
