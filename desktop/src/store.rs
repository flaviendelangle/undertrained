use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Default, Serialize, Deserialize)]
pub struct Settings {
    pub rider_name: String,
    pub trainer_id: Option<String>,
    pub heart_rate_id: Option<String>,
    /// Guided rides start with ERG on: the rider's last choice on the ready screen. Files
    /// from before it existed start with ERG off.
    #[serde(default)]
    pub start_with_erg: bool,
}

/// The settings file: in the platform's settings folder, or under `root` for the smoke
/// test, which never reads or writes the rider's own.
pub fn path(root: Option<&Path>) -> Result<PathBuf> {
    if let Some(root) = root {
        return Ok(root.join("settings.json"));
    }
    let dirs = ProjectDirs::from("app", "Undertrained", "Undertrained Indoor")
        .context("Could not locate your application settings folder")?;
    Ok(dirs.config_dir().join("settings.json"))
}

pub fn load(root: Option<&Path>) -> Result<Settings> {
    let path = path(root)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    serde_json::from_slice(&fs::read(path)?).context("Could not read saved settings")
}

pub fn save(settings: &Settings, root: Option<&Path>) -> Result<()> {
    let path = path(root)?;
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
    fn older_files_with_retired_entries_still_load_and_keep_their_fields() {
        // Builds before the account-driven language wrote a desktop preference here, and
        // builds with a switchable workout board saved its layout. Neither may fail to
        // parse or influence anything: they are simply dropped.
        let saved: Settings = serde_json::from_str(
            r#"{"rider_name":"Flavien","trainer_id":"hci0/dev_AA","heart_rate_id":null,"language":"fr-FR","library_variant":2}"#,
        )
        .unwrap();
        assert_eq!(saved.rider_name, "Flavien");
        assert_eq!(saved.trainer_id.as_deref(), Some("hci0/dev_AA"));
        assert!(saved.heart_rate_id.is_none());
        assert!(!saved.start_with_erg, "No ERG choice saved yet: off");
        let rewritten = serde_json::to_string(&saved).unwrap();
        assert!(
            !rewritten.contains("language") && !rewritten.contains("library_variant"),
            "Retired entries are not carried forward"
        );
        assert!(rewritten.contains("\"trainer_id\":\"hci0/dev_AA\""));
    }
}
