use std::path::{Path, PathBuf};

use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use crate::state::{lock, AppState};

const FALLBACK_FILE_NAME: &str = "download";

/// Saves downloads (CSV exports, attachments, chart images) to the OS Downloads folder and
/// announces them once finished.
pub fn handle_download(webview: Webview, event: DownloadEvent<'_>) -> bool {
    let app = webview.app_handle();
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Ok(downloads_dir) = app.path().download_dir() else {
                log::error!("The Downloads folder could not be found");
                return false;
            };
            *destination = download_destination(&downloads_dir, destination, |path| path.exists());
            remember_destination(app, url.as_str(), destination.clone());
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let remembered = forget_destination(app, url.as_str());
            if success {
                announce_download(app, path.or(remembered));
            } else {
                log::warn!("The download of {url} failed");
            }
            true
        }
        _ => true,
    }
}

/// Keeps only the file name of the proposed destination, so a download always lands directly in
/// the Downloads folder, and appends ` (n)` when a file with that name already exists.
pub fn download_destination(
    downloads_dir: &Path,
    proposed: &Path,
    exists: impl Fn(&Path) -> bool,
) -> PathBuf {
    let file_name = proposed
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(FALLBACK_FILE_NAME);

    let candidate = downloads_dir.join(file_name);
    if !exists(&candidate) {
        return candidate;
    }

    let (stem, extension) = split_extension(file_name);
    (1..)
        .map(|counter| downloads_dir.join(format!("{stem} ({counter}){extension}")))
        .find(|candidate| !exists(candidate))
        .expect("an unused file name always exists")
}

fn split_extension(file_name: &str) -> (&str, String) {
    match file_name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (file_name, String::new()),
    }
}

fn remember_destination(app: &AppHandle, url: &str, destination: PathBuf) {
    lock(&app.state::<AppState>().downloads).insert(url.to_string(), destination);
}

fn forget_destination(app: &AppHandle, url: &str) -> Option<PathBuf> {
    lock(&app.state::<AppState>().downloads).remove(url)
}

fn announce_download(app: &AppHandle, path: Option<PathBuf>) {
    let file_name = path
        .as_deref()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "The file".to_string());

    let shown = app
        .notification()
        .builder()
        .title("Download complete")
        .body(format!("{file_name} was saved to your Downloads folder."))
        .show();

    if let (Err(error), Some(path)) = (shown, path) {
        log::warn!("Could not show the download notification: {error}");
        let _ = app.opener().reveal_item_in_dir(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn downloads() -> PathBuf {
        PathBuf::from("/home/me/Downloads")
    }

    #[test]
    fn keeps_the_suggested_file_name_in_the_downloads_folder() {
        let destination =
            download_destination(&downloads(), Path::new("/tmp/report.csv"), |_| false);

        assert_eq!(destination, downloads().join("report.csv"));
    }

    #[test]
    fn never_leaves_the_downloads_folder() {
        let destination = download_destination(
            &downloads(),
            Path::new("../../.ssh/authorized_keys"),
            |_| false,
        );

        assert_eq!(destination, downloads().join("authorized_keys"));
    }

    #[test]
    fn falls_back_to_a_generic_name() {
        let destination = download_destination(&downloads(), Path::new(""), |_| false);

        assert_eq!(destination, downloads().join("download"));
    }

    #[test]
    fn appends_a_counter_when_the_file_already_exists() {
        let taken = [
            downloads().join("report.csv"),
            downloads().join("report (1).csv"),
        ];

        let destination = download_destination(&downloads(), Path::new("report.csv"), |path| {
            taken.iter().any(|taken| taken == path)
        });

        assert_eq!(destination, downloads().join("report (2).csv"));
    }

    #[test]
    fn handles_names_without_an_extension_and_dotfiles() {
        let destination = download_destination(&downloads(), Path::new("README"), |path| {
            path == downloads().join("README")
        });
        let dotfile = download_destination(&downloads(), Path::new(".env"), |path| {
            path == downloads().join(".env")
        });

        assert_eq!(destination, downloads().join("README (1)"));
        assert_eq!(dotfile, downloads().join(".env (1)"));
    }
}
