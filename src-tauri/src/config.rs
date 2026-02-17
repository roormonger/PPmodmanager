use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub steam_api_key: String,
    #[serde(default)]
    pub people_playground_dir: String,
    #[serde(default)]
    pub steamcmd_dir: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            steam_api_key: String::new(),
            people_playground_dir: String::new(),
            steamcmd_dir: String::new(),
        }
    }
}

pub struct ConfigState(pub Mutex<Config>);

/// App data directory: %APPDATA%\PPModManager
pub fn app_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PPModManager")
}

fn config_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

pub fn load_config() -> Config {
    let path = config_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Config::default()
    }
}

pub fn save_config(config: &Config) -> Result<(), String> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    let path = config_path();
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| format!("Failed to save config: {}", e))
}

#[tauri::command]
pub fn get_config(state: tauri::State<'_, ConfigState>) -> Config {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_config_cmd(
    state: tauri::State<'_, ConfigState>,
    steam_api_key: String,
    people_playground_dir: String,
    steamcmd_dir: String,
) -> Result<String, String> {
    println!("[Config] Saving: APIKey={}, GameDir={}, SteamCMDDir={}", 
             if steam_api_key.is_empty() { "empty" } else { "set" }, 
             people_playground_dir, steamcmd_dir);
    let mut config = state.0.lock().unwrap();
    config.steam_api_key = steam_api_key;
    config.people_playground_dir = people_playground_dir;
    config.steamcmd_dir = steamcmd_dir;
    save_config(&config)?;
    Ok("Settings saved successfully!".to_string())
}
