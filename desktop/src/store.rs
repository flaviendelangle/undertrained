use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Default, Serialize, Deserialize)]
pub struct Settings {
    pub rider_name: String,
    pub trainer_id: Option<String>,
    pub heart_rate_id: Option<String>,
    /// An explicit interface language chosen on this computer ("en-GB" or "fr-FR").
    /// Absent means follow the account, then the operating system.
    #[serde(default)]
    pub language: Option<String>,
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
