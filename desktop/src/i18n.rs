//! Language selection, and the few user-facing strings Rust has to build itself.
//!
//! Screen text lives in `ui/app.slint` behind `@tr(...)` and is translated by the bundled
//! catalogs under `ui/lang`. Rust only produces values whose shape depends on the language:
//! durations, the workout meta line, and display names for ANT+ devices, whose driver names
//! are generic English. Everything else reaches Slint as a state code and is worded there.
use crate::model::Device;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Lang {
    #[default]
    En,
    Fr,
}

impl Lang {
    /// The website's locale tag; also what the server receives.
    pub fn tag(self) -> &'static str {
        match self {
            Lang::En => "en-GB",
            Lang::Fr => "fr-FR",
        }
    }

    /// Folder of the bundled Slint translation. English is the source language.
    pub fn slint_code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Fr => "fr",
        }
    }

    /// Accepts website tags ("fr-FR"), plain codes ("fr") and POSIX locales ("fr_FR.UTF-8").
    pub fn parse(value: &str) -> Option<Lang> {
        let base = value
            .trim()
            .split(['-', '_', '.', '@', ':'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        match base.as_str() {
            "en" => Some(Lang::En),
            "fr" => Some(Lang::Fr),
            _ => None,
        }
    }
}

/// Use the native language preference APIs on Windows/macOS and locale variables
/// on Unix. sys-locale is already a Slint dependency; this adds no new package.
pub fn os_language() -> Option<Lang> {
    sys_locale::get_locales().find_map(|value| Lang::parse(&value))
}

/// Saved desktop preference, then the account's language, then the OS, then English.
pub fn resolve(saved: Option<&str>, account: Option<&str>) -> Lang {
    saved
        .and_then(Lang::parse)
        .or_else(|| account.and_then(Lang::parse))
        .or_else(os_language)
        .unwrap_or_default()
}

/// "45 min", "1 h", "1 h 05 min". Both languages abbreviate the same way.
pub fn duration(_lang: Lang, seconds: u32) -> String {
    let minutes = seconds.div_ceil(60).max(1);
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m:02} min"),
    }
}

/// The card's second line: the server's own label when it sends one, otherwise the
/// duration and, when estimated, the TSS.
pub fn workout_meta(lang: Lang, label: Option<&str>, seconds: u32, tss: Option<f64>) -> String {
    match (label, tss) {
        (Some(label), _) => label.to_owned(),
        (None, Some(tss)) => format!("{} · {} TSS", duration(lang, seconds), tss.round() as i64),
        (None, None) => duration(lang, seconds),
    }
}

/// The device number inside an `ant:<type>:<number>:<transmission>` id.
pub fn ant_number(id: &str) -> Option<&str> {
    id.strip_prefix("ant:")?.split(':').nth(1)
}

/// A localized display name for an ANT+ device. The driver names them in English from the
/// profile it decoded, so the same facts (capabilities and number) are reworded here.
/// Bluetooth devices keep the name they advertise.
pub fn device_name(lang: Lang, device: &Device) -> String {
    let Some(number) = ant_number(&device.id) else {
        return device.name.clone();
    };
    let caps = &device.capabilities;
    let kind = match (lang, caps.trainer, caps.heart_rate) {
        (Lang::En, true, _) => "Trainer",
        (Lang::Fr, true, _) => "Home trainer",
        (Lang::En, false, true) => "Heart-rate sensor",
        (Lang::Fr, false, true) => "Capteur cardiaque",
        (Lang::En, false, false) => "Power sensor",
        (Lang::Fr, false, false) => "Capteur de puissance",
    };
    format!("{kind} {number} · ANT+")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Capabilities;

    #[test]
    fn parses_website_tags_and_posix_locales() {
        assert_eq!(Lang::parse("fr-FR"), Some(Lang::Fr));
        assert_eq!(Lang::parse("fr_FR.UTF-8"), Some(Lang::Fr));
        assert_eq!(Lang::parse("en-GB"), Some(Lang::En));
        assert_eq!(Lang::parse("EN"), Some(Lang::En));
        assert_eq!(Lang::parse("C"), None);
        assert_eq!(Lang::parse("de_DE"), None);
        assert_eq!(Lang::parse(""), None);
    }

    #[test]
    fn saved_preference_beats_account_beats_english() {
        assert_eq!(resolve(Some("fr-FR"), Some("en-GB")), Lang::Fr);
        assert_eq!(resolve(None, Some("fr-FR")), Lang::Fr);
        assert_eq!(resolve(Some("klingon"), Some("fr-FR")), Lang::Fr);
        // Without a saved or account language the OS decides, and English is the last resort.
        let os = os_language().unwrap_or_default();
        assert_eq!(resolve(None, None), os);
        assert_eq!(resolve(None, Some("xx")), os);
    }

    #[test]
    fn durations_and_meta_lines() {
        assert_eq!(duration(Lang::En, 2700), "45 min");
        assert_eq!(duration(Lang::Fr, 3600), "1 h");
        assert_eq!(duration(Lang::En, 3900), "1 h 05 min");
        assert_eq!(duration(Lang::En, 10), "1 min");
        assert_eq!(
            workout_meta(Lang::En, None, 3600, Some(72.4)),
            "1 h · 72 TSS"
        );
        assert_eq!(workout_meta(Lang::Fr, None, 2700, None), "45 min");
        assert_eq!(
            workout_meta(Lang::Fr, Some("Variable · jusqu'à 43 min"), 1, None),
            "Variable · jusqu'à 43 min"
        );
    }

    #[test]
    fn ant_devices_get_localized_names_and_bluetooth_keeps_its_own() {
        let strap = Device {
            id: "ant:120:43220:1".into(),
            name: "Heart-rate sensor 43220 · ANT+".into(),
            capabilities: Capabilities {
                heart_rate: true,
                ..Default::default()
            },
            rssi: None,
        };
        assert_eq!(ant_number(&strap.id), Some("43220"));
        assert_eq!(
            device_name(Lang::Fr, &strap),
            "Capteur cardiaque 43220 · ANT+"
        );
        assert_eq!(
            device_name(Lang::En, &strap),
            "Heart-rate sensor 43220 · ANT+"
        );
        let ble = Device {
            id: "hci0/dev_AA_BB".into(),
            name: "KICKR CORE 1A2B".into(),
            capabilities: Capabilities {
                trainer: true,
                ..Default::default()
            },
            rssi: Some(-50),
        };
        assert_eq!(ant_number(&ble.id), None);
        assert_eq!(device_name(Lang::Fr, &ble), "KICKR CORE 1A2B");
    }
}
