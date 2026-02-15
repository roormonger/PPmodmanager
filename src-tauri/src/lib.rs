mod config;
mod steamapi;
mod steamcmd;

use config::ConfigState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg = config::load_config();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(ConfigState(Mutex::new(cfg)))
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::save_config_cmd,
            steamapi::search_mods_cmd,
            steamapi::get_mod_details_cmd,
            steamcmd::install_mod,
            steamcmd::list_installed_mods,
            steamcmd::delete_installed_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
