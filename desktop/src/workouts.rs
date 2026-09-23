//! Read-only account workout access and UI-independent request state.
use crate::auth::{Session, server_url};
use serde::Deserialize;
use std::{collections::HashSet, time::Duration};

/// Where a workout comes from. Personal workouts have numeric ids and their own web page.
/// Built-in tests are shared by the server, keyed by a slug it chooses, and all live in one
/// section of the website's workouts page.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum WorkoutId {
    Personal(i64),
    BuiltIn(String),
}

impl WorkoutId {
    /// A stable row key that cannot collide across the two kinds.
    pub fn key(&self) -> String {
        match self {
            WorkoutId::Personal(id) => format!("p:{id}"),
            WorkoutId::BuiltIn(slug) => format!("b:{slug}"),
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        if let Some(id) = key.strip_prefix("p:") {
            id.parse()
                .ok()
                .filter(|id| *id > 0)
                .map(WorkoutId::Personal)
        } else if let Some(slug) = key.strip_prefix("b:") {
            valid_slug(slug).then(|| WorkoutId::BuiltIn(slug.to_owned()))
        } else {
            None
        }
    }

    pub fn is_built_in(&self) -> bool {
        matches!(self, WorkoutId::BuiltIn(_))
    }
}

/// Built-in ids are server-defined slugs. The catalogue itself is never hard-coded here.
fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[derive(Clone, Debug, PartialEq)]
pub struct Workout {
    pub id: WorkoutId,
    pub name: String,
    pub duration_seconds: u32,
    /// Server wording for built-in tests, whose duration is a maximum rather than a plan.
    pub duration_label: Option<String>,
    pub estimated_tss: Option<f64>,
    /// The FTP the server used to generate a built-in profile.
    pub reference_ftp: Option<f64>,
    pub summary: String,
    /// Duration in seconds and percent FTP, or None for free riding.
    pub profile: Vec<(u32, Option<f64>)>,
    pub execution: Option<crate::player::Plan>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LoadError {
    Unauthorized,
    Unavailable,
    Network,
    InvalidResponse,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonalWire {
    #[serde(default)]
    execution: Option<crate::player::Plan>,
    id: i64,
    name: String,
    duration_seconds: u32,
    estimated_tss: Option<f64>,
    summary: String,
    profile: Vec<(u32, Option<f64>)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltInWire {
    #[serde(default)]
    execution: Option<crate::player::Plan>,
    id: String,
    name: String,
    summary: String,
    duration_seconds: u32,
    duration_label: String,
    #[serde(default)]
    estimated_tss: Option<f64>,
    reference_ftp: f64,
    profile: Vec<(u32, Option<f64>)>,
}

/// Older servers omit `builtInWorkouts`; that parses as an empty list.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    workouts: Vec<PersonalWire>,
    #[serde(default)]
    built_in_workouts: Vec<BuiltInWire>,
}

fn valid_profile(profile: &[(u32, Option<f64>)], tss: Option<f64>) -> bool {
    profile
        .iter()
        .try_fold(0u32, |sum, (duration, _)| sum.checked_add(*duration))
        .is_some()
        && !tss.is_some_and(|n| !n.is_finite() || n < 0.0)
        && !profile
            .iter()
            .any(|(_, p)| p.is_some_and(|n| !n.is_finite() || n < 0.0))
}

fn convert(response: Response) -> Result<Vec<Workout>, LoadError> {
    let mut workouts =
        Vec::with_capacity(response.workouts.len() + response.built_in_workouts.len());
    let mut seen = HashSet::new();
    for w in response.workouts {
        if w.id <= 0 || !valid_profile(&w.profile, w.estimated_tss) {
            return Err(LoadError::InvalidResponse);
        }
        let id = WorkoutId::Personal(w.id);
        if !seen.insert(id.clone()) {
            return Err(LoadError::InvalidResponse);
        }
        workouts.push(Workout {
            id,
            name: w.name,
            duration_seconds: w.duration_seconds,
            duration_label: None,
            estimated_tss: w.estimated_tss,
            reference_ftp: None,
            summary: w.summary,
            profile: w.profile,
            execution: w.execution.filter(crate::player::Plan::valid),
        });
    }
    for w in response.built_in_workouts {
        if !valid_slug(&w.id)
            || w.duration_label.trim().is_empty()
            || !(w.reference_ftp.is_finite() && w.reference_ftp > 0.0)
            || !valid_profile(&w.profile, w.estimated_tss)
        {
            return Err(LoadError::InvalidResponse);
        }
        let id = WorkoutId::BuiltIn(w.id);
        if !seen.insert(id.clone()) {
            return Err(LoadError::InvalidResponse);
        }
        workouts.push(Workout {
            id,
            name: w.name,
            duration_seconds: w.duration_seconds,
            duration_label: Some(w.duration_label),
            estimated_tss: w.estimated_tss,
            reference_ftp: Some(w.reference_ftp),
            summary: w.summary,
            profile: w.profile,
            execution: w.execution.filter(crate::player::Plan::valid),
        });
    }
    Ok(workouts)
}

/// Personal workouts first, in server order, then the shared built-in tests. The locale
/// ("en-GB" or "fr-FR") picks the language of built-in names and labels; older servers
/// ignore it. Personal workout text is the rider's own and never translated.
pub async fn fetch(session: &Session, locale: &str) -> Result<Vec<Workout>, LoadError> {
    let origin = server_url(&session.origin).map_err(|_| LoadError::InvalidResponse)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| LoadError::Network)?;
    let mut url = origin
        .join("api/desktop/workouts")
        .map_err(|_| LoadError::InvalidResponse)?;
    url.query_pairs_mut().append_pair("locale", locale);
    let response = client
        .get(url)
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
    convert(result)
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

/// Built-in tests have no page of their own; the website lists them in one section.
pub fn built_in_web_url(origin: &str) -> anyhow::Result<String> {
    let mut url = server_url(origin)?.join("workouts")?;
    url.set_fragment(Some("built-in-workouts"));
    Ok(url.to_string())
}

/// The website page for a workout of either kind.
pub fn link(origin: &str, id: &WorkoutId) -> anyhow::Result<String> {
    match id {
        WorkoutId::Personal(id) => web_url(origin, Some(*id)),
        WorkoutId::BuiltIn(_) => built_in_web_url(origin),
    }
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

    /// Case-insensitive, trimmed name search over personal and built-in workouts alike.
    pub fn filtered(&self, query: &str) -> Vec<&Workout> {
        let query = query.trim().to_lowercase();
        self.workouts
            .iter()
            .filter(|w| w.name.to_lowercase().contains(&query))
            .collect()
    }

    pub fn personal_count(&self) -> usize {
        self.workouts.iter().filter(|w| !w.id.is_built_in()).count()
    }

    pub fn contains(&self, id: &WorkoutId) -> bool {
        self.workouts.iter().any(|w| &w.id == id)
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
            id: WorkoutId::Personal(42),
            name: "Tempo ride".into(),
            duration_seconds: 1800,
            duration_label: None,
            estimated_tss: None,
            reference_ftp: None,
            summary: "30:00 @ 80%".into(),
            profile: vec![(1800, Some(80.0))],
            execution: None,
        }
    }

    fn built_in() -> Workout {
        Workout {
            id: WorkoutId::BuiltIn("step-test".into()),
            name: "Step test".into(),
            duration_seconds: 1500,
            duration_label: Some("up to 25 min".into()),
            estimated_tss: None,
            reference_ftp: Some(250.0),
            summary: "Ramps until you stop".into(),
            profile: vec![(300, Some(50.0)), (1200, Some(120.0))],
            execution: None,
        }
    }

    #[test]
    fn execution_is_optional_and_invalid_targets_never_become_runnable() {
        let value = serde_json::json!({"workouts":[{"id":1,"name":"Ramps","durationSeconds":60,"estimatedTss":null,"summary":"", "profile":[[60,80]], "execution":{"referenceFtp":250,"ftpTest":null,"segments":[{"durationSeconds":60,"startWatts":100,"endWatts":200,"cadence":90}]}}]});
        let valid = convert(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert_eq!(
            valid[0].execution.as_ref().unwrap().segments[0].end_watts,
            Some(200.0)
        );
        let mut invalid = value.clone();
        invalid["workouts"][0]["execution"]["segments"][0]["endWatts"] = serde_json::Value::Null;
        assert!(
            convert(serde_json::from_value(invalid).unwrap()).unwrap()[0]
                .execution
                .is_none()
        );
        let mut old = value;
        old["workouts"][0]
            .as_object_mut()
            .unwrap()
            .remove("execution");
        assert!(
            convert(serde_json::from_value(old).unwrap()).unwrap()[0]
                .execution
                .is_none()
        );
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
        assert!(library.finish(latest, Ok(vec![workout(), built_in()])));
        assert_eq!(library.filtered(" TEMPO ").len(), 1);
        assert_eq!(
            library.filtered("step").len(),
            1,
            "Built-ins are searchable"
        );
        assert!(library.filtered("VO2").is_empty());
        assert_eq!(library.personal_count(), 1);
        assert!(library.contains(&WorkoutId::BuiltIn("step-test".into())));
        let refresh = library.begin();
        library.finish(refresh, Err(LoadError::Network));
        assert_eq!(library.workouts.len(), 2);
        let refresh = library.begin();
        library.finish(refresh, Err(LoadError::Unauthorized));
        assert!(library.workouts.is_empty());
    }

    #[test]
    fn row_keys_are_stable_and_kind_specific() {
        for id in [
            WorkoutId::Personal(7),
            WorkoutId::BuiltIn("ramp-test".into()),
        ] {
            assert_eq!(WorkoutId::from_key(&id.key()), Some(id));
        }
        assert_eq!(WorkoutId::from_key("p:0"), None);
        assert_eq!(WorkoutId::from_key("b:Ramp Test"), None);
        assert_eq!(WorkoutId::from_key("b:-x"), None);
        assert_eq!(WorkoutId::from_key("ramp-test"), None);
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
        assert_eq!(
            link(
                "https://undertrained.example",
                &WorkoutId::BuiltIn("ramp-test".into())
            )
            .unwrap(),
            "https://undertrained.example/workouts#built-in-workouts",
            "Built-ins open the shared section, never a slug page"
        );
        assert_eq!(
            link("https://undertrained.example", &WorkoutId::Personal(42)).unwrap(),
            "https://undertrained.example/workouts/42"
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
            assert!(
                request.starts_with("get /api/desktop/workouts?locale=fr-fr http/1.1"),
                "The interface language travels as a query: {request}"
            );
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
                    language: None,
                },
            },
            task,
        )
    }

    const PERSONAL: &str = r#"{"id":42,"name":"Tempo ride","durationSeconds":1800,"estimatedTss":null,"summary":"30:00 @ 80%","profile":[[1800,80]]}"#;
    const BUILT_IN: &str = r#"{"id":"step-test","name":"Step test","summary":"Ramps until you stop","durationSeconds":1500,"durationLabel":"up to 25 min","estimatedTss":null,"referenceFtp":250,"profile":[[300,50],[1200,120]]}"#;

    #[tokio::test]
    async fn authenticated_list_and_failures() {
        // A server from before built-ins existed.
        let (session, server) = serve("200 OK", &format!(r#"{{"workouts":[{PERSONAL}]}}"#)).await;
        assert_eq!(fetch(&session, "fr-FR").await.unwrap(), vec![workout()]);
        server.await.unwrap();
        // Built-ins arrive after personal workouts and keep their own identity.
        let (session, server) = serve(
            "200 OK",
            &format!(r#"{{"workouts":[{PERSONAL}],"builtInWorkouts":[{BUILT_IN}]}}"#),
        )
        .await;
        assert_eq!(
            fetch(&session, "fr-FR").await.unwrap(),
            vec![workout(), built_in()]
        );
        server.await.unwrap();
        // Built-ins show even when the personal library is empty.
        let (session, server) = serve(
            "200 OK",
            &format!(r#"{{"workouts":[],"builtInWorkouts":[{BUILT_IN}]}}"#),
        )
        .await;
        assert_eq!(fetch(&session, "fr-FR").await.unwrap(), vec![built_in()]);
        server.await.unwrap();
        let (session, server) = serve("200 OK", r#"{"workouts":[]}"#).await;
        assert!(fetch(&session, "fr-FR").await.unwrap().is_empty());
        server.await.unwrap();
        let bad_slug = BUILT_IN.replace("\"step-test\"", "\"Step Test\"");
        let bad_ftp = BUILT_IN.replace("\"referenceFtp\":250", "\"referenceFtp\":0");
        let duplicate = format!(r#"{{"workouts":[],"builtInWorkouts":[{BUILT_IN},{BUILT_IN}]}}"#);
        for (status, body, error) in [
            ("401 Unauthorized", "{}".to_string(), LoadError::Unauthorized),
            ("404 Not Found", "{}".to_string(), LoadError::Unavailable),
            (
                "500 Internal Server Error",
                "private details".to_string(),
                LoadError::Network,
            ),
            ("302 Found", "{}".to_string(), LoadError::Network),
            (
                "200 OK",
                "<html>login</html>".to_string(),
                LoadError::InvalidResponse,
            ),
            (
                "200 OK",
                r#"{"workouts":[{"id":42,"name":"Invalid profile","durationSeconds":1800,"estimatedTss":null,"summary":"","profile":[[4294967295,80],[1,80]]}]}"#.to_string(),
                LoadError::InvalidResponse,
            ),
            (
                "200 OK",
                format!(r#"{{"workouts":[],"builtInWorkouts":[{bad_slug}]}}"#),
                LoadError::InvalidResponse,
            ),
            (
                "200 OK",
                format!(r#"{{"workouts":[],"builtInWorkouts":[{bad_ftp}]}}"#),
                LoadError::InvalidResponse,
            ),
            ("200 OK", duplicate, LoadError::InvalidResponse),
        ] {
            let (session, server) = serve(status, &body).await;
            assert_eq!(fetch(&session, "fr-FR").await.unwrap_err(), error);
            server.await.unwrap();
        }
    }
}
