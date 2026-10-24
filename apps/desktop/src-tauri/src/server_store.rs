use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::server_url::default_server_name;

pub const NAO_CLOUD_ID: &str = "nao-cloud";
pub const NAO_CLOUD_NAME: &str = "nao Cloud";
pub const NAO_CLOUD_URL: &str = "https://app.getnao.io";

const STORE_FILE: &str = "servers.json";
const SERVERS_KEY: &str = "servers";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub last_used_at: Option<i64>,
    #[serde(default)]
    pub built_in: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ServerListError {
    #[error("This server is not in your list.")]
    NotFound,
    #[error("nao Cloud can't be removed.")]
    BuiltIn,
}

/// The servers the user can connect to. nao Cloud is always present and its URL always comes
/// from [`NAO_CLOUD_URL`], whatever was saved on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerList {
    servers: Vec<Server>,
}

impl ServerList {
    pub fn from_saved(saved: Vec<Server>) -> Self {
        let cloud_last_used_at = saved
            .iter()
            .find(|server| server.id == NAO_CLOUD_ID)
            .and_then(|server| server.last_used_at);
        let mut list = Self {
            servers: vec![nao_cloud(cloud_last_used_at)],
        };

        for server in saved {
            if server.id != NAO_CLOUD_ID && !list.contains_id_or_url(&server.id, &server.url) {
                list.servers.push(Server {
                    built_in: false,
                    ..server
                });
            }
        }
        list
    }

    pub fn from_json(value: Option<Value>) -> Self {
        let saved = value
            .and_then(|value| serde_json::from_value::<Vec<Server>>(value).ok())
            .unwrap_or_default();
        Self::from_saved(saved)
    }

    pub fn to_json(&self) -> Value {
        serde_json::to_value(&self.servers).expect("servers always serialize to JSON")
    }

    pub fn servers(&self) -> &[Server] {
        &self.servers
    }

    pub fn find(&self, id: &str) -> Option<&Server> {
        self.servers.iter().find(|server| server.id == id)
    }

    pub fn last_used(&self) -> Option<&Server> {
        self.servers
            .iter()
            .filter(|server| server.last_used_at.is_some())
            .max_by_key(|server| server.last_used_at)
    }

    /// Adding a URL that is already in the list returns the existing entry.
    pub fn add(&mut self, url: &str, name: Option<&str>, id: String) -> Server {
        if let Some(existing) = self.servers.iter().find(|server| server.url == url) {
            return existing.clone();
        }

        let name = name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| default_server_name(url));
        let server = Server {
            id,
            name,
            url: url.to_string(),
            last_used_at: None,
            built_in: false,
        };
        self.servers.push(server.clone());
        server
    }

    pub fn remove(&mut self, id: &str) -> Result<(), ServerListError> {
        let server = self.find(id).ok_or(ServerListError::NotFound)?;
        if server.built_in {
            return Err(ServerListError::BuiltIn);
        }
        self.servers.retain(|server| server.id != id);
        Ok(())
    }

    pub fn mark_used(&mut self, id: &str, now_ms: i64) -> Result<Server, ServerListError> {
        let server = self
            .servers
            .iter_mut()
            .find(|server| server.id == id)
            .ok_or(ServerListError::NotFound)?;
        server.last_used_at = Some(now_ms);
        Ok(server.clone())
    }

    fn contains_id_or_url(&self, id: &str, url: &str) -> bool {
        self.servers
            .iter()
            .any(|server| server.id == id || server.url == url)
    }
}

pub fn load_server_list<R: Runtime>(app: &AppHandle<R>) -> ServerList {
    match app.store(STORE_FILE) {
        Ok(store) => ServerList::from_json(store.get(SERVERS_KEY)),
        Err(error) => {
            log::error!("Could not open the server store: {error}");
            ServerList::from_saved(Vec::new())
        }
    }
}

pub fn save_server_list<R: Runtime>(app: &AppHandle<R>, list: &ServerList) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|error| error.to_string())?;
    store.set(SERVERS_KEY, list.to_json());
    store.save().map_err(|error| error.to_string())
}

fn nao_cloud(last_used_at: Option<i64>) -> Server {
    Server {
        id: NAO_CLOUD_ID.to_string(),
        name: NAO_CLOUD_NAME.to_string(),
        url: NAO_CLOUD_URL.to_string(),
        last_used_at,
        built_in: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn self_hosted(id: &str, url: &str) -> Server {
        Server {
            id: id.into(),
            name: id.into(),
            url: url.into(),
            last_used_at: None,
            built_in: false,
        }
    }

    #[test]
    fn always_contains_nao_cloud_first() {
        let list = ServerList::from_saved(vec![self_hosted("acme", "https://nao.acme.com")]);

        assert_eq!(list.servers()[0].id, NAO_CLOUD_ID);
        assert_eq!(list.servers()[0].url, NAO_CLOUD_URL);
        assert!(list.servers()[0].built_in);
        assert_eq!(list.servers().len(), 2);
    }

    #[test]
    fn restores_the_cloud_url_from_the_constant_but_keeps_its_last_used_time() {
        let tampered = Server {
            url: "https://evil.example".into(),
            last_used_at: Some(42),
            ..self_hosted(NAO_CLOUD_ID, "https://evil.example")
        };

        let list = ServerList::from_saved(vec![tampered]);

        assert_eq!(list.servers().len(), 1);
        assert_eq!(list.servers()[0].url, NAO_CLOUD_URL);
        assert_eq!(list.servers()[0].name, NAO_CLOUD_NAME);
        assert_eq!(list.servers()[0].last_used_at, Some(42));
    }

    #[test]
    fn drops_duplicate_entries_and_built_in_flags_from_disk() {
        let duplicated_url = self_hosted("b", "https://nao.acme.com");
        let forged_built_in = Server {
            built_in: true,
            ..self_hosted("c", "https://other.acme.com")
        };

        let list = ServerList::from_saved(vec![
            self_hosted("a", "https://nao.acme.com"),
            duplicated_url,
            self_hosted("a", "https://third.acme.com"),
            forged_built_in,
        ]);

        let ids: Vec<&str> = list
            .servers()
            .iter()
            .map(|server| server.id.as_str())
            .collect();
        assert_eq!(ids, vec![NAO_CLOUD_ID, "a", "c"]);
        assert!(!list.find("c").unwrap().built_in);
    }

    #[test]
    fn adds_a_server_with_a_default_name() {
        let mut list = ServerList::from_saved(Vec::new());

        let server = list.add("http://localhost:5005", None, "local".into());

        assert_eq!(server.name, "localhost:5005");
        assert_eq!(server.url, "http://localhost:5005");
        assert!(!server.built_in);
        assert_eq!(list.find("local"), Some(&server));
    }

    #[test]
    fn adds_a_server_with_a_custom_name() {
        let mut list = ServerList::from_saved(Vec::new());

        let server = list.add("https://nao.acme.com", Some("  Acme  "), "acme".into());

        assert_eq!(server.name, "Acme");
    }

    #[test]
    fn returns_the_existing_entry_when_a_url_is_added_twice() {
        let mut list = ServerList::from_saved(Vec::new());
        let first = list.add("https://nao.acme.com", Some("Acme"), "acme".into());

        let second = list.add("https://nao.acme.com", Some("Other"), "other".into());
        let cloud = list.add(NAO_CLOUD_URL, None, "cloud-copy".into());

        assert_eq!(second, first);
        assert_eq!(cloud.id, NAO_CLOUD_ID);
        assert_eq!(list.servers().len(), 2);
    }

    #[test]
    fn removes_self_hosted_servers() {
        let mut list = ServerList::from_saved(vec![self_hosted("acme", "https://nao.acme.com")]);

        list.remove("acme").unwrap();

        assert!(list.find("acme").is_none());
    }

    #[test]
    fn refuses_to_remove_nao_cloud_or_unknown_servers() {
        let mut list = ServerList::from_saved(Vec::new());

        assert_eq!(list.remove(NAO_CLOUD_ID), Err(ServerListError::BuiltIn));
        assert_eq!(list.remove("missing"), Err(ServerListError::NotFound));
        assert!(list.find(NAO_CLOUD_ID).is_some());
    }

    #[test]
    fn tracks_the_last_used_server() {
        let mut list = ServerList::from_saved(vec![
            self_hosted("a", "https://a.example"),
            self_hosted("b", "https://b.example"),
        ]);
        assert!(list.last_used().is_none());

        list.mark_used("b", 100).unwrap();
        list.mark_used("a", 200).unwrap();

        assert_eq!(list.last_used().unwrap().id, "a");
        assert_eq!(list.find("b").unwrap().last_used_at, Some(100));
        assert_eq!(list.mark_used("missing", 1), Err(ServerListError::NotFound));
    }

    #[test]
    fn round_trips_through_json() {
        let mut list = ServerList::from_saved(Vec::new());
        list.add("https://nao.acme.com", Some("Acme"), "acme".into());
        list.mark_used("acme", 1234).unwrap();

        let restored = ServerList::from_json(Some(list.to_json()));

        assert_eq!(restored, list);
    }

    #[test]
    fn serializes_fields_in_camel_case() {
        let list = ServerList::from_saved(Vec::new());

        assert_eq!(
            list.to_json(),
            json!([{
                "id": NAO_CLOUD_ID,
                "name": NAO_CLOUD_NAME,
                "url": NAO_CLOUD_URL,
                "lastUsedAt": null,
                "builtIn": true
            }])
        );
    }

    #[test]
    fn falls_back_to_the_default_list_when_the_saved_value_is_missing_or_corrupt() {
        let default_list = ServerList::from_saved(Vec::new());

        assert_eq!(ServerList::from_json(None), default_list);
        assert_eq!(
            ServerList::from_json(Some(json!("not a list"))),
            default_list
        );
    }
}
