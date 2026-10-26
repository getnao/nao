use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use tokio::sync::oneshot;
use url::Url;

use crate::navigation::Destination;
use crate::server_store::{Server, ServerList};

pub struct PendingSignIn {
    pub attempt: u64,
    pub cancel: oneshot::Sender<()>,
}

pub struct AppState {
    pub local_ui: Url,
    pub http: reqwest::Client,
    pub destination: Mutex<Destination>,
    pub active_server: Mutex<Option<Server>>,
    pub servers: Mutex<ServerList>,
    pub sign_in: Mutex<Option<PendingSignIn>>,
    pub downloads: Mutex<HashMap<String, PathBuf>>,
    /// Bumped every time the main webview switches content, so background work started
    /// for a previous screen (server checks, health monitoring) can tell it is stale.
    view_generation: AtomicU64,
    sign_in_attempts: AtomicU64,
}

impl AppState {
    pub fn new(local_ui: Url, http: reqwest::Client, servers: ServerList) -> Self {
        Self {
            local_ui,
            http,
            destination: Mutex::new(Destination::LocalUi),
            active_server: Mutex::new(None),
            servers: Mutex::new(servers),
            sign_in: Mutex::new(None),
            downloads: Mutex::new(HashMap::new()),
            view_generation: AtomicU64::new(0),
            sign_in_attempts: AtomicU64::new(0),
        }
    }

    pub fn next_view_generation(&self) -> u64 {
        self.view_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn view_generation(&self) -> u64 {
        self.view_generation.load(Ordering::SeqCst)
    }

    pub fn next_sign_in_attempt(&self) -> u64 {
        self.sign_in_attempts.fetch_add(1, Ordering::SeqCst) + 1
    }
}

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
