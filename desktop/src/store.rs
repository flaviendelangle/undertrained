use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Default, Serialize, Deserialize)]
pub struct Settings {
    pub rider_name: String,
    pub trainer_id: Option<String>,
    pub heart_rate_id: Option<String>,
}

pub fn path() -> Result<PathBuf> {
    let dirs = ProjectDirs::from("app", "Undertrained", "Undertrained Indoor")
        .context("Could not locate your application settings folder")?;
    Ok(dirs.config_dir().join("settings.json"))
}

pub fn load() -> Result<Settings> {
    let path = path()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    serde_json::from_slice(&fs::read(path)?).context("Could not read saved settings")
}

pub fn save(settings: &Settings) -> Result<()> {
    let path = path()?;
    fs::create_dir_all(path.parent().context("Invalid settings path")?)?;
    // Writing a sibling first keeps a partial write from corrupting preferences.
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(settings)?)?;
    fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_files_with_a_language_entry_still_load_and_keep_their_fields() {
        // Builds before the account-driven language wrote a desktop preference here.
        // It must neither fail to parse nor influence anything: it is simply dropped.
        let saved: Settings = serde_json::from_str(
            r#"{"rider_name":"Flavien","trainer_id":"hci0/dev_AA","heart_rate_id":null,"language":"fr-FR"}"#,
        )
        .unwrap();
        assert_eq!(saved.rider_name, "Flavien");
        assert_eq!(saved.trainer_id.as_deref(), Some("hci0/dev_AA"));
        assert!(saved.heart_rate_id.is_none());
        let rewritten = serde_json::to_string(&saved).unwrap();
        assert!(
            !rewritten.contains("language"),
            "The entry is not carried forward"
        );
        assert!(rewritten.contains("\"trainer_id\":\"hci0/dev_AA\""));
    }
}
