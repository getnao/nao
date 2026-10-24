use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::controller::show_screen;
use crate::screens::Screen;
use crate::server_info::is_server_healthy;
use crate::server_store::Server;
use crate::state::AppState;

const CHECK_INTERVAL: Duration = Duration::from_secs(10);
const FAILURES_BEFORE_UNREACHABLE: u32 = 3;

/// Counts consecutive failed health checks so a single network blip doesn't
/// replace the server UI with the "unreachable" screen.
#[derive(Debug, Default)]
pub struct HealthTracker {
    consecutive_failures: u32,
}

impl HealthTracker {
    pub fn record(&mut self, healthy: bool) -> bool {
        if healthy {
            self.consecutive_failures = 0;
            return false;
        }
        self.consecutive_failures += 1;
        self.consecutive_failures == FAILURES_BEFORE_UNREACHABLE
    }
}

/// Polls the server while its UI is shown and stops as soon as the main webview shows something else.
pub fn watch(app: AppHandle, server: Server, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let mut tracker = HealthTracker::default();
        loop {
            tokio::time::sleep(CHECK_INTERVAL).await;
            let state = app.state::<AppState>();
            if state.view_generation() != generation {
                return;
            }

            let healthy = is_server_healthy(&state.http, &server.url).await;
            if state.view_generation() != generation {
                return;
            }
            if tracker.record(healthy) {
                show_screen(
                    &app,
                    Screen::Unreachable {
                        server_id: server.id.clone(),
                        reason: "unreachable".to_string(),
                    },
                );
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_after_consecutive_failures() {
        let mut tracker = HealthTracker::default();

        assert!(!tracker.record(false));
        assert!(!tracker.record(false));
        assert!(tracker.record(false));
    }

    #[test]
    fn resets_after_a_successful_check() {
        let mut tracker = HealthTracker::default();

        tracker.record(false);
        tracker.record(false);
        assert!(!tracker.record(true));
        assert!(!tracker.record(false));
        assert!(!tracker.record(false));
        assert!(tracker.record(false));
    }

    #[test]
    fn reports_only_once() {
        let mut tracker = HealthTracker::default();
        for _ in 0..FAILURES_BEFORE_UNREACHABLE {
            tracker.record(false);
        }

        assert!(!tracker.record(false));
    }
}
