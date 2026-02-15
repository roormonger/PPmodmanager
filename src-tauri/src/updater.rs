use tauri_plugin_updater::UpdaterExt;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version.to_string(),
            date: update.date.map(|d| d.to_string()),
            body: update.body.map(|b| b.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let mut downloaded = 0;
            update.download_and_install(
                move |chunk_length, content_length| {
                    downloaded += chunk_length;
                    println!("Downloaded {downloaded} from {content_length:?}");
                },
                || {
                    println!("Download finished");
                },
            ).await.map_err(|e| format!("Install failed: {}", e))?;
            
            // Restart app
            app.restart();
            #[allow(unreachable_code)]
            Ok(())
        },
        Ok(None) => Err("No update found".to_string()),
        Err(e) => Err(format!("Check failed: {}", e)),
    }
}
