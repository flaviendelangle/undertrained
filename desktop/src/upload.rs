//! Upload finalized local rides through the account's desktop API. Never uploads automatically.
use crate::auth::{Session, server_url};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path, time::Duration};

#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    Unauthorized,
    Unavailable,
    Permission,
    Network,
    Server,
    InvalidResponse,
    Local(String),
    DifferentAccount,
    Uncertain,
    Rejected(String),
}
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Complete(i64),
    Processing,
}
#[derive(Clone, Serialize, Deserialize)]
struct Ticket {
    #[serde(rename = "uploadId")]
    upload_id: i64,
    receipt: String,
}
#[derive(Serialize, Deserialize)]
struct Saved {
    origin: String,
    athlete_id: i64,
    ticket: Option<Ticket>,
    activity_id: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    activity_id: Option<i64>,
    error: Option<String>,
}
fn local(error: impl std::fmt::Display) -> Error {
    Error::Local(error.to_string())
}
fn save(directory: &Path, state: &Saved) -> Result<(), Error> {
    let temporary = directory.join("upload.tmp");
    let destination = directory.join(if state.activity_id.is_some() {
        "upload-complete.json"
    } else if state.ticket.is_some() {
        "upload-ticket.json"
    } else {
        "upload.json"
    });
    let mut file = fs::File::create(&temporary).map_err(local)?;
    file.write_all(&serde_json::to_vec(state).map_err(local)?)
        .map_err(local)?;
    file.sync_all().map_err(local)?;
    drop(file);
    if destination.exists() {
        fs::remove_file(temporary).map_err(local)?;
    } else {
        fs::rename(temporary, destination).map_err(local)?;
    }
    #[cfg(unix)]
    fs::File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(local)?;
    Ok(())
}
fn response_status(response: &reqwest::Response) -> Result<(), Error> {
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 => Err(Error::Unauthorized),
        403 => Err(Error::Permission),
        404 | 405 | 503 => Err(Error::Unavailable),
        _ => Err(Error::Server),
    }
}
/// Returns the completed activity, or Processing after a bounded polling period. Calling
/// again resumes the saved upload instead of submitting the FIT file again. A submission
/// with no receipt is deliberately not repeated: it may already have reached Strava.
pub async fn run(session: &Session, directory: &Path, name: &str) -> Result<Outcome, Error> {
    let origin = server_url(&session.origin).map_err(|_| Error::InvalidResponse)?;
    let mut url = origin
        .join("api/desktop/uploads")
        .map_err(|_| Error::InvalidResponse)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(75))
        .build()
        .map_err(|_| Error::Network)?;
    let saved_path = ["upload-complete.json", "upload-ticket.json", "upload.json"]
        .into_iter()
        .map(|name| directory.join(name))
        .find(|path| path.exists())
        .unwrap_or_else(|| directory.join("upload.json"));
    let mut state = if saved_path.exists() {
        let state: Saved =
            serde_json::from_slice(&fs::read(&saved_path).map_err(local)?).map_err(local)?;
        if state.origin != session.origin || state.athlete_id != session.athlete.id {
            return Err(Error::DifferentAccount);
        }
        if let Some(id) = state.activity_id {
            return Ok(Outcome::Complete(id));
        }
        if state.ticket.is_none() {
            return Err(Error::Uncertain);
        }
        state
    } else {
        let file = fs::read(directory.join("ride.fit")).map_err(local)?;
        if file.len() > 7 * 1024 * 1024 {
            return Err(Error::Local("Recording exceeds the upload limit".into()));
        }
        let mut state = Saved {
            origin: session.origin.clone(),
            athlete_id: session.athlete.id,
            ticket: None,
            activity_id: None,
        };
        // Persist intent before sending. A process crash or timeout cannot silently cause a
        // second submission on the next click.
        save(directory, &state)?;
        let response = client
            .post(url.clone())
            .bearer_auth(&session.token)
            .json(&serde_json::json!({"name":name,"fitFileBase64":STANDARD.encode(file)}))
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) if error.is_connect() => {
                // No connection means no submission reached the server. An ordinary
                // network retry is safe; response timeouts remain ambiguous.
                fs::remove_file(&saved_path).map_err(local)?;
                return Err(Error::Network);
            }
            Err(_) => return Err(Error::Uncertain),
        };
        if let Err(error) = response_status(&response) {
            // These responses are definitive pre-submission rejections and can be retried
            // after fixing authentication/deployment. 5xx is ambiguous; keep the intent.
            if matches!(
                response.status().as_u16(),
                400 | 401 | 403 | 404 | 405 | 413 | 429 | 503
            ) {
                fs::remove_file(&saved_path).map_err(local)?;
                return Err(error);
            }
            return Err(Error::Uncertain);
        }
        let ticket: Ticket = response.json().await.map_err(|_| Error::Uncertain)?;
        if ticket.upload_id <= 0 || ticket.receipt.is_empty() || ticket.receipt.len() > 250 {
            return Err(Error::Uncertain);
        }
        state.ticket = Some(ticket);
        save(directory, &state)?;
        state
    };
    let ticket = state.ticket.as_ref().ok_or(Error::Uncertain)?;
    url.query_pairs_mut()
        .append_pair("receipt", &ticket.receipt);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    for attempt in 0..30 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        let checked = tokio::time::timeout_at(deadline, async {
            let response = client
                .get(url.clone())
                .bearer_auth(&session.token)
                .send()
                .await
                .map_err(|_| Error::Network)?;
            response_status(&response)?;
            response
                .json::<Status>()
                .await
                .map_err(|_| Error::InvalidResponse)
        })
        .await;
        let status = match checked {
            Ok(result) => result?,
            Err(_) => return Ok(Outcome::Processing),
        };
        if let Some(id) = status.activity_id.filter(|id| *id > 0) {
            state.activity_id = Some(id);
            save(directory, &state)?;
            return Ok(Outcome::Complete(id));
        }
        if let Some(error) = status.error.filter(|s| !s.is_empty()) {
            return Err(Error::Rejected(error));
        }
    }
    Ok(Outcome::Processing)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upload_receipt_has_no_account_credentials() {
        let state = Saved {
            origin: "https://example.org/".into(),
            athlete_id: 7,
            ticket: Some(Ticket {
                upload_id: 3,
                receipt: "signed".into(),
            }),
            activity_id: None,
        };
        let bytes = serde_json::to_vec(&state).unwrap();
        let decoded: Saved = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.ticket.unwrap().upload_id, 3);
        assert!(!String::from_utf8(bytes).unwrap().contains("token"));
    }
}

#[cfg(test)]
mod request_tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    fn directory() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "undertrained-upload-test-{}",
            rand::random::<u64>()
        ));
        fs::create_dir(&path).unwrap();
        fs::write(path.join("ride.fit"), b"fixture FIT payload").unwrap();
        path
    }
    fn session(origin: String) -> Session {
        Session {
            origin,
            token: "private-test-token".into(),
            athlete: crate::auth::Athlete {
                id: 7,
                name: "Test".into(),
                language: None,
            },
        }
    }
    async fn serve(listener: TcpListener, responses: Vec<(u16, &'static str)>) -> Vec<String> {
        let mut requests = vec![];
        for (status, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![];
            loop {
                let mut buffer = [0u8; 4096];
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0);
                bytes.extend(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|n| n.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            let reply = format!(
                "HTTP/1.1 {status} Response\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(reply.as_bytes()).await.unwrap();
        }
        requests
    }
    #[tokio::test]
    async fn connection_failure_can_be_retried_without_an_uncertain_marker() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let session = session(format!("http://{}/", listener.local_addr().unwrap()));
        drop(listener);
        let dir = directory();
        assert_eq!(run(&session, &dir, "Ride").await, Err(Error::Network));
        assert!(!dir.join("upload.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn completed_upload_is_saved_and_never_posted_twice() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let session = session(format!("http://{}/", listener.local_addr().unwrap()));
        let server = tokio::spawn(serve(
            listener,
            vec![
                (202, r#"{"uploadId":42,"receipt":"signed"}"#),
                (200, r#"{"activityId":84,"error":null}"#),
            ],
        ));
        let dir = directory();
        assert_eq!(run(&session, &dir, "Ride").await, Ok(Outcome::Complete(84)));
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("POST /api/desktop/uploads "));
        assert!(requests[1].starts_with("GET /api/desktop/uploads?receipt=signed "));
        assert_eq!(run(&session, &dir, "Ride").await, Ok(Outcome::Complete(84)));
        let saved = fs::read_to_string(dir.join("upload-complete.json")).unwrap();
        assert!(!saved.contains(&session.token));
        let mut other = session.clone();
        other.athlete.id = 8;
        assert_eq!(
            run(&other, &dir, "Ride").await,
            Err(Error::DifferentAccount)
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn unavailable_endpoint_allows_later_retry_but_ambiguous_submission_does_not() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let session = session(format!("http://{}/", listener.local_addr().unwrap()));
        let server = tokio::spawn(serve(listener, vec![(404, "{}"), (502, "{}")]));
        let dir = directory();
        assert_eq!(run(&session, &dir, "Ride").await, Err(Error::Unavailable));
        assert!(!dir.join("upload.json").exists());
        assert_eq!(run(&session, &dir, "Ride").await, Err(Error::Uncertain));
        assert!(dir.join("upload.json").exists());
        assert_eq!(run(&session, &dir, "Ride").await, Err(Error::Uncertain));
        assert_eq!(server.await.unwrap().len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn polling_failure_preserves_receipt_and_retry_only_checks_status() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let session = session(format!("http://{}/", listener.local_addr().unwrap()));
        let server = tokio::spawn(serve(
            listener,
            vec![
                (202, r#"{"uploadId":42,"receipt":"signed"}"#),
                (502, "{}"),
                (200, r#"{"activityId":84,"error":null}"#),
            ],
        ));
        let dir = directory();
        assert_eq!(run(&session, &dir, "Ride").await, Err(Error::Server));
        assert_eq!(run(&session, &dir, "Ride").await, Ok(Outcome::Complete(84)));
        let requests = server.await.unwrap();
        assert_eq!(
            requests.iter().filter(|r| r.starts_with("POST ")).count(),
            1
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
