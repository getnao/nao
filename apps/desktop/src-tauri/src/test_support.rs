use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

type Responder = dyn Fn(&str) -> (u16, String) + Send + Sync;

/// A minimal HTTP/1.1 server answering every request from a `path -> (status, body)` function.
pub struct StubHttpServer {
    port: u16,
}

impl StubHttpServer {
    pub async fn start(respond: impl Fn(&str) -> (u16, String) + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let respond: Arc<Responder> = Arc::new(respond);

        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let respond = respond.clone();
                tokio::spawn(async move {
                    let mut buffer = vec![0u8; 4096];
                    let read = stream.read(&mut buffer).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let (status, body) = respond(&path);
                    let response = format!(
                        "HTTP/1.1 {status} Stub\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });

        Self { port }
    }

    pub async fn unused_origin() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        format!("http://127.0.0.1:{port}")
    }

    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}
