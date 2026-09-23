//! Read-only account workout access and UI-independent request state.
use crate::auth::{Session, server_url};
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workout {
    pub id: i64,
    pub name: String,
    pub duration_seconds: u32,
    pub estimated_tss: Option<f64>,
    pub summary: String,
    /// Duration in seconds and percent FTP, or None for free riding.
    pub profile: Vec<(u32, Option<f64>)>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LoadError {
    Unauthorized,
    Unavailable,
    Network,
    InvalidResponse,
}

#[derive(Deserialize)]
struct Response {
    workouts: Vec<Workout>,
}

pub async fn fetch(session: &Session) -> Result<Vec<Workout>, LoadError> {
    let origin = server_url(&session.origin).map_err(|_| LoadError::InvalidResponse)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| LoadError::Network)?;
    let response = client
        .get(
            origin
                .join("api/desktop/workouts")
                .map_err(|_| LoadError::InvalidResponse)?,
        )
        .bearer_auth(&session.token)
        .send()
        .await
        .map_err(|_| LoadError::Network)?;
    match response.status().as_u16() {
        401 => return Err(LoadError::Unauthorized),
        404 | 405 | 501 => return Err(LoadError::Unavailable),
        200 => {}
        _ => return Err(LoadError::Network),
    }
    let result = response
        .json::<Response>()
        .await
        .map_err(|_| LoadError::InvalidResponse)?;
    if result.workouts.iter().any(|w| {
        w.id <= 0
            || w.profile
                .iter()
                .try_fold(0u32, |sum, (duration, _)| sum.checked_add(*duration))
                .is_none()
            || w.estimated_tss.is_some_and(|n| !n.is_finite() || n < 0.0)
            || w.profile
                .iter()
                .any(|(_, p)| p.is_some_and(|n| !n.is_finite() || n < 0.0))
    }) {
        return Err(LoadError::InvalidResponse);
    }
    Ok(result.workouts)
}

/// Uses a validated origin and numeric ID. Desktop credentials never enter URLs.
pub fn web_url(origin: &str, id: Option<i64>) -> anyhow::Result<String> {
    let path = match id {
        Some(id) if id > 0 => format!("workouts/{id}"),
        Some(_) => anyhow::bail!("Invalid workout ID"),
        None => "workouts/new".to_owned(),
    };
    Ok(server_url(origin)?.join(&path)?.to_string())
}

#[derive(Default)]
pub struct Library {
    pub workouts: Vec<Workout>,
    pub loading: bool,
    pub loaded: bool,
    pub error: Option<LoadError>,
    generation: u64,
}

impl Library {
    /// Invalidate outstanding results before signing out or switching accounts.
    pub fn clear(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.workouts.clear();
        self.loading = false;
        self.loaded = false;
        self.error = None;
    }

    /// Keep a previously loaded library visible during refresh.
    pub fn begin(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.loading = true;
        self.error = None;
        self.generation
    }

    /// Returns false when a response belongs to an older request or account.
    pub fn finish(&mut self, generation: u64, result: Result<Vec<Workout>, LoadError>) -> bool {
        if generation != self.generation {
            return false;
        }
        self.loading = false;
        match result {
            Ok(workouts) => {
                self.workouts = workouts;
                self.loaded = true;
                self.error = None;
            }
            Err(error) => {
                if error == LoadError::Unauthorized {
                    self.workouts.clear();
                    self.loaded = false;
                }
                self.error = Some(error);
            }
        }
        true
    }

    pub fn filtered(&self, query: &str) -> Vec<&Workout> {
        let query = query.trim().to_lowercase();
        self.workouts
            .iter()
            .filter(|w| w.name.to_lowercase().contains(&query))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn workout() -> Workout {
        Workout {
            id: 42,
            name: "Tempo ride".into(),
            duration_seconds: 1800,
            estimated_tss: None,
            summary: "30:00 @ 80%".into(),
            profile: vec![(1800, Some(80.0))],
        }
    }

    #[test]
    fn account_switch_and_newer_requests_discard_old_results() {
        let mut library = Library::default();
        let old = library.begin();
        library.clear();
        assert!(!library.finish(old, Ok(vec![workout()])));
        let first = library.begin();
        let latest = library.begin();
        assert!(!library.finish(first, Err(LoadError::Unauthorized)));
        assert!(library.finish(latest, Ok(vec![workout()])));
        assert_eq!(library.filtered(" TEMPO ").len(), 1);
        assert!(library.filtered("VO2").is_empty());
        let refresh = library.begin();
        library.finish(refresh, Err(LoadError::Network));
        assert_eq!(library.workouts.len(), 1);
        let refresh = library.begin();
        library.finish(refresh, Err(LoadError::Unauthorized));
        assert!(library.workouts.is_empty());
    }

    #[test]
    fn browser_links_never_carry_credentials() {
        assert_eq!(
            web_url("https://undertrained.example", Some(42)).unwrap(),
            "https://undertrained.example/workouts/42"
        );
        assert_eq!(
            web_url("https://undertrained.example", None).unwrap(),
            "https://undertrained.example/workouts/new"
        );
        assert!(web_url("https://user:secret@example.com", None).is_err());
        assert!(web_url("https://example.com", Some(-1)).is_err());
    }

    async fn serve(status: &str, body: &str) -> (Session, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0; 1024];
                let count = socket.read(&mut chunk).await.unwrap();
                assert!(count > 0);
                request.extend_from_slice(&chunk[..count]);
                if request.windows(4).any(|s| s == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8(request).unwrap().to_lowercase();
            assert!(request.starts_with("get /api/desktop/workouts http/1.1"));
            assert!(request.contains("authorization: bearer test-token\r\n"));
            socket.write_all(reply.as_bytes()).await.unwrap();
        });
        (
            Session {
                origin,
                token: "test-token".into(),
                athlete: crate::auth::Athlete {
                    id: 1,
                    name: "Rider".into(),
                },
            },
            task,
        )
    }

    #[tokio::test]
    async fn authenticated_list_and_failures() {
        let (session, server) = serve("200 OK", r#"{"workouts":[{"id":42,"name":"Tempo ride","durationSeconds":1800,"estimatedTss":null,"summary":"30:00 @ 80%","profile":[[1800,80]]}]}"#).await;
        assert_eq!(fetch(&session).await.unwrap(), vec![workout()]);
        server.await.unwrap();
        let (session, server) = serve("200 OK", r#"{"workouts":[]}"#).await;
        assert!(fetch(&session).await.unwrap().is_empty());
        server.await.unwrap();
        for (status, body, error) in [
            ("401 Unauthorized", "{}", LoadError::Unauthorized),
            ("404 Not Found", "{}", LoadError::Unavailable),
            (
                "500 Internal Server Error",
                "private details",
                LoadError::Network,
            ),
            ("302 Found", "{}", LoadError::Network),
            ("200 OK", "<html>login</html>", LoadError::InvalidResponse),
            (
                "200 OK",
                r#"{"workouts":[{"id":42,"name":"Invalid profile","durationSeconds":1800,"estimatedTss":null,"summary":"","profile":[[4294967295,80],[1,80]]}]}"#,
                LoadError::InvalidResponse,
            ),
        ] {
            let (session, server) = serve(status, body).await;
            assert_eq!(fetch(&session).await.unwrap_err(), error);
            server.await.unwrap();
        }
    }
}
