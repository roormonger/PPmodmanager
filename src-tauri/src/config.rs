use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

    // Persistence
    #[serde(default = "default_browse_sort")]
    pub browse_sort_type: u32,
    #[serde(default = "default_browse_days")]
    pub browse_sort_days: u32,
    #[serde(default)]
    pub browse_tags: Vec<String>,
    #[serde(default = "default_browse_sort")]
    pub collections_sort_type: u32,
    #[serde(default = "default_browse_days")]
    pub collections_sort_days: u32,
    #[serde(default = "default_desc")]
    pub collections_sort_dir: String,
    #[serde(default = "default_mod_sort")]
    pub installed_sort_by: String,
    #[serde(default = "default_desc")]
    pub installed_sort_dir: String,
    #[serde(default = "default_mod_sort")]
    pub contraptions_sort_by: String,
    #[serde(default = "default_desc")]
    pub contraptions_sort_dir: String,
}

fn default_browse_sort() -> u32 { 3 }
fn default_browse_days() -> u32 { 7 }
fn default_mod_sort() -> String { "date".to_string() }
fn default_desc() -> String { "desc".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedMetadata {
    pub title: String,
    pub author: String,
    pub preview_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            steam_api_key: String::new(),
            people_playground_dir: String::new(),
            steamcmd_dir: String::new(),
            browse_sort_type: 3,
            browse_sort_days: 7,
            browse_tags: vec![],
            collections_sort_type: 3,
            collections_sort_days: 7,
            collections_sort_dir: "desc".to_string(),
            installed_sort_by: "date".to_string(),
            installed_sort_dir: "desc".to_string(),
            contraptions_sort_by: "date".to_string(),
            contraptions_sort_dir: "desc".to_string(),
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
    println!("[Config] Saving settings: APIKey={}, GameDir={}, SteamCMDDir={}", 
             if steam_api_key.is_empty() { "empty" } else { "set" }, 
             people_playground_dir, steamcmd_dir);
    let mut config = state.0.lock().unwrap();
    config.steam_api_key = steam_api_key;
    config.people_playground_dir = people_playground_dir;
    config.steamcmd_dir = steamcmd_dir;
    save_config(&config)?;
    Ok("Settings saved successfully!".to_string())
}

#[tauri::command]
pub fn save_ui_state_cmd(
    state: tauri::State<'_, ConfigState>,
    browse_sort_type: u32,
    browse_sort_days: u32,
    browse_tags: Vec<String>,
    collections_sort_type: u32,
    collections_sort_days: u32,
    collections_sort_dir: String,
    installed_sort_by: String,
    installed_sort_dir: String,
    contraptions_sort_by: String,
    contraptions_sort_dir: String,
) -> Result<(), String> {
    let mut config = state.0.lock().unwrap();
    config.browse_sort_type = browse_sort_type;
    config.browse_sort_days = browse_sort_days;
    config.browse_tags = browse_tags;
    config.collections_sort_type = collections_sort_type;
    config.collections_sort_days = collections_sort_days;
    config.collections_sort_dir = collections_sort_dir;
    config.installed_sort_by = installed_sort_by;
    config.installed_sort_dir = installed_sort_dir;
    config.contraptions_sort_by = contraptions_sort_by;
    config.contraptions_sort_dir = contraptions_sort_dir;
    save_config(&config)
}

fn metadata_cache_path() -> PathBuf {
    app_data_dir().join("metadata_cache.json")
}

#[tauri::command]
pub fn load_metadata_cache_cmd() -> HashMap<String, CachedMetadata> {
    let path = metadata_cache_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

#[tauri::command]
pub fn save_metadata_cache_cmd(cache: HashMap<String, CachedMetadata>) -> Result<(), String> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    let path = metadata_cache_path();
    let data = serde_json::to_string_pretty(&cache).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| format!("Failed to save metadata cache: {}", e))
}
