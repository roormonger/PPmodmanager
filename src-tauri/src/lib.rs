mod config;
mod steamapi;
mod steamcmd;
mod updater;

use config::ConfigState;
use std::sync::Mutex;

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg = config::load_config();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(ConfigState(Mutex::new(cfg)))
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            config::get_config,
            config::save_config_cmd,
            steamapi::search_mods_cmd,
            steamapi::get_mod_details_cmd,
            steamcmd::install_mod,
            steamcmd::list_installed_mods,
            steamcmd::delete_installed_mod,
            updater::check_for_updates,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
