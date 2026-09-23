use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Athlete {
    pub id: i64,
    pub name: String,
    /// The account's interface language ("en-GB" or "fr-FR"). Older servers omit it.
    #[serde(default)]
    pub language: Option<String>,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    athlete: Athlete,
}
#[derive(Deserialize)]
struct SessionResponse {
    athlete: Athlete,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    pub origin: String,
    pub token: String,
    pub athlete: Athlete,
}

pub fn server_url(value: &str) -> Result<Url> {
    let mut url =
        Url::parse(value.trim()).context("Enter the full URL of your Undertrained server")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        bail!("Use HTTPS, or HTTP on localhost for development");
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        bail!("Enter only the server origin, without a path or credentials");
    }
    url.set_path("/");
    Ok(url)
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

fn random_proof() -> String {
    let mut bytes = [0; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub async fn login(value: &str) -> Result<Session> {
    login_with_browser(value, |url| {
        open::that(url).context("Could not open your browser")
    })
    .await
}

async fn login_with_browser(
    value: &str,
    browser: impl FnOnce(&str) -> Result<()>,
) -> Result<Session> {
    let origin = server_url(value)?;
    // Probe before opening the browser: old servers must not look like a login in progress.
    let probe = client()?
        .get(origin.join("api/desktop/session")?)
        .send()
        .await
        .context("Cannot reach Undertrained. Check the server address and connection.")?;
    if probe.status() != reqwest::StatusCode::UNAUTHORIZED {
        bail!(
            "This server does not have desktop sign-in enabled yet. Install the companion backend update."
        );
    }
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let redirect = format!(
        "http://127.0.0.1:{}/callback",
        listener.local_addr()?.port()
    );
    let state = random_proof();
    let verifier = random_proof();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorize = origin.join("api/desktop/authorize")?;
    authorize
        .query_pairs_mut()
        .append_pair("redirect_uri", &redirect)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge);
    browser(authorize.as_str())?;
    let code = timeout(Duration::from_secs(300), async {
        loop {
            let (mut socket, _) = listener.accept().await?;
            let mut request = Vec::new();
            let read = timeout(Duration::from_secs(3), async {
                while request.len() < 8192 && !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let mut buffer = [0; 1024];
                    let count = socket.read(&mut buffer).await?;
                    if count == 0 { break; }
                    request.extend_from_slice(&buffer[..count]);
                }
                Ok::<_, std::io::Error>(())
            }).await;
            if !matches!(read, Ok(Ok(()))) { continue; }
            let text = String::from_utf8_lossy(&request);
            let mut first = text.lines().next().unwrap_or_default().split_whitespace();
            let method = first.next().unwrap_or_default();
            let path = first.next().unwrap_or_default();
            let parsed = Url::parse(&format!("http://127.0.0.1{path}"));
            let code = parsed.ok().and_then(|url| {
                if method != "GET" || url.path() != "/callback" { return None; }
                let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
                if params.get("state") != Some(&state) { return None; }
                params.get("code").filter(|c| c.len() == 43).cloned()
            });
            let body = if code.is_some() { "Authorization received. Return to Undertrained Indoor to finish signing in." } else { "Invalid sign-in callback." };
            let status = if code.is_some() { "200 OK" } else { "400 Bad Request" };
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            let _ = socket.write_all(response.as_bytes()).await;
            if let Some(code) = code { return Ok::<_, anyhow::Error>(code); }
        }
    }).await.context("Sign-in expired. Please try again.")??;
    let response = client()?
        .post(origin.join("api/desktop/token")?)
        .json(&serde_json::json!({ "code": code, "code_verifier": verifier }))
        .send()
        .await?
        .error_for_status()
        .context("The sign-in code could not be exchanged. Please try again.")?
        .json::<TokenResponse>()
        .await?;
    Ok(Session {
        origin: origin.to_string(),
        token: response.access_token,
        athlete: response.athlete,
    })
}

pub fn persist(session: &Session) -> Result<()> {
    keyring::Entry::new("undertrained-indoor", "session")?
        .set_password(&serde_json::to_string(session)?)?;
    Ok(())
}

pub fn stored() -> Result<Option<Session>> {
    match keyring::Entry::new("undertrained-indoor", "session")?.get_password() {
        Ok(value) => Ok(Some(serde_json::from_str(&value)?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn forget() -> Result<()> {
    match keyring::Entry::new("undertrained-indoor", "session")?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub async fn validate(mut session: Session) -> Result<Session> {
    let origin = server_url(&session.origin)?;
    let response = client()?
        .get(origin.join("api/desktop/session")?)
        .bearer_auth(&session.token)
        .send()
        .await?
        .error_for_status()?
        .json::<SessionResponse>()
        .await?;
    session.athlete = response.athlete;
    Ok(session)
}

pub async fn revoke(session: Session) -> Result<()> {
    let origin = server_url(&session.origin)?;
    client()?
        .delete(origin.join("api/desktop/session")?)
        .bearer_auth(&session.token)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_insecure_remote_servers_and_credential_urls() {
        assert!(server_url("https://training.example").is_ok());
        assert!(server_url("http://localhost:3000").is_ok());
        for bad in [
            "http://training.example",
            "https://user:secret@example.com",
            "https://example.com/path",
            "https://example.com?x=1",
        ] {
            assert!(server_url(bad).is_err());
        }
    }
    #[test]
    fn proofs_have_256_bits_of_entropy_and_url_safe_encoding() {
        let proof = random_proof();
        assert_eq!(proof.len(), 43);
        assert_eq!(URL_SAFE_NO_PAD.decode(proof).unwrap().len(), 32);
    }
    #[tokio::test]
    async fn old_server_is_reported_before_opening_a_browser() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });
        let error = login_with_browser(&origin, |_| panic!("Old servers must not open a browser"))
            .await
            .err()
            .unwrap();
        assert!(error.to_string().contains("desktop sign-in enabled"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn browser_handoff_checks_state_and_exchanges_pkce() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let challenge = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let expected_challenge = challenge.clone();
        let code = "a".repeat(43);
        let expected_code = code.clone();
        let server = tokio::spawn(async move {
            for step in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut buffer = [0; 4096];
                    let count = socket.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                    let text = String::from_utf8_lossy(&request);
                    if let Some((headers, body)) = text.split_once("\r\n\r\n") {
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length: ")
                                    .map(|v| v.parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if body.len() >= length {
                            break;
                        }
                    }
                }
                let text = String::from_utf8_lossy(&request);
                if step == 0 {
                    assert!(text.starts_with("GET /api/desktop/session "));
                    socket.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                } else {
                    assert!(text.starts_with("POST /api/desktop/token "));
                    let (_, body) = text.split_once("\r\n\r\n").unwrap();
                    let data: serde_json::Value = serde_json::from_str(body).unwrap();
                    assert_eq!(data["code"], expected_code);
                    let verifier = data["code_verifier"].as_str().unwrap();
                    assert_eq!(
                        URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
                        *expected_challenge.lock().unwrap()
                    );
                    let body = r#"{"access_token":"test-token","athlete":{"id":42,"name":"Test Rider","language":"fr-FR"}}"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    socket.write_all(response.as_bytes()).await.unwrap();
                }
            }
        });
        let session = login_with_browser(&origin, move |url| {
            let url = Url::parse(url)?;
            let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            *challenge.lock().unwrap() = params["code_challenge"].clone();
            let mut callback = Url::parse(&params["redirect_uri"])?;
            callback
                .query_pairs_mut()
                .append_pair("code", &code)
                .append_pair("state", "wrong-state");
            let state = params["state"].clone();
            tokio::spawn(async move {
                let client = reqwest::Client::new();
                assert_eq!(
                    client.get(callback.clone()).send().await.unwrap().status(),
                    400
                );
                callback.set_query(None);
                callback
                    .query_pairs_mut()
                    .append_pair("code", &code)
                    .append_pair("state", &state);
                assert_eq!(client.get(callback).send().await.unwrap().status(), 200);
            });
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(session.athlete.id, 42);
        assert_eq!(session.athlete.name, "Test Rider");
        assert_eq!(session.athlete.language.as_deref(), Some("fr-FR"));
        assert_eq!(session.token, "test-token");
        let older: Athlete = serde_json::from_str(r#"{"id":1,"name":"Rider"}"#).unwrap();
        assert!(
            older.language.is_none(),
            "Servers without a language still deserialize"
        );
        server.await.unwrap();
    }
}
