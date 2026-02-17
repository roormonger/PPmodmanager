use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Get the steamcmd install directory (%APPDATA%\PPModManager\steamcmd)
fn steamcmd_dir() -> PathBuf {
    crate::config::app_data_dir().join("steamcmd")
}

fn steamcmd_exe() -> PathBuf {
    steamcmd_dir().join("steamcmd.exe")
}

/// Ensure SteamCMD is downloaded and ready
pub fn ensure_installed() -> Result<(), String> {
    let exe = steamcmd_exe();
    if exe.exists() {
        return Ok(());
    }

    println!("Downloading SteamCMD...");
    let dir = steamcmd_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create steamcmd dir: {}", e))?;

    let zip_path = dir.join("steamcmd.zip");
    let url = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

    // Download
    let response =
        reqwest::blocking::get(url).map_err(|e| format!("Failed to download SteamCMD: {}", e))?;
    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read response: {}", e))?;
    fs::write(&zip_path, &bytes).map_err(|e| format!("Failed to write zip: {}", e))?;

    // Extract
    let file = fs::File::open(&zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {}", e))?;
        let outpath = dir.join(entry.name());

        if entry.is_dir() {
            fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut outfile =
                fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Cleanup zip
    fs::remove_file(&zip_path).ok();
    println!("SteamCMD installed to {:?}", dir);
    Ok(())
}

/// Download a workshop item
pub fn download_workshop_item(app_id: &str, workshop_id: &str) -> Result<String, String> {
    ensure_installed()?;

    let exe = steamcmd_exe();
    let dir = steamcmd_dir();

    println!(
        "Downloading workshop item {} for app {}...",
        workshop_id, app_id
    );

    let mut cmd = Command::new(&exe);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd
        .current_dir(&dir)
        .args([
            "+login",
            "anonymous",
            "+workshop_download_item",
            app_id,
            workshop_id,
            "validate", // Force validation to fix "File Not Found" errors
            "+quit",
        ])
        .output()
        .map_err(|e| format!("Failed to run SteamCMD: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!(
            "SteamCMD failed:\nstdout: {}\nstderr: {}",
            stdout, stderr
        ));
    }

    let download_path = dir
        .join("steamapps")
        .join("workshop")
        .join("content")
        .join(app_id)
        .join(workshop_id);

    if download_path.is_dir() {
        Ok(download_path.to_string_lossy().to_string())
    } else {
        Err(format!(
            "Download verification failed: {:?} not found.\n\
            SteamCMD output:\n{}",
            download_path, stdout
        ))
    }
}

/// Install a mod: download via SteamCMD and move to mods folder
#[tauri::command]
pub async fn install_mod(
    state: tauri::State<'_, crate::config::ConfigState>,
    workshop_id: String,
) -> Result<String, String> {
    let config = state.0.lock().unwrap().clone();

    if config.people_playground_dir.is_empty() {
        return Err("Mods folder not set. Go to Settings to configure it.".to_string());
    }

    let workshop_id_for_move = workshop_id.clone();
    let app_id = "1118200"; // People Playground
    // ── Logic ─────────────────────────────────────────

    let download_path = tokio::task::spawn_blocking(move || {
        // Try first attempt
        match download_workshop_item(app_id, &workshop_id) {
            Ok(path) => Ok(path),
            Err(e) => {
                println!(
                    "First download attempt failed: {}. Cleaning cache and retrying...",
                    e
                );
                // Clean cache and target
                let dir = steamcmd_dir();
                // 1. cleanup downloads staging
                let staging = dir
                    .join("steamapps")
                    .join("workshop")
                    .join("downloads")
                    .join(app_id);
                if staging.exists() {
                    let _ = fs::remove_dir_all(&staging);
                }
                // 2. cleanup content target
                let content = dir
                    .join("steamapps")
                    .join("workshop")
                    .join("content")
                    .join(app_id)
                    .join(&workshop_id);
                if content.exists() {
                    let _ = fs::remove_dir_all(&content);
                }
                // 3. cleanup ACF file (force re-index)
                let acf = dir
                    .join("steamapps")
                    .join("workshop")
                    .join(format!("appworkshop_{}.acf", app_id));
                if acf.exists() {
                    let _ = fs::remove_file(&acf);
                }

                // Retry
                download_workshop_item(app_id, &workshop_id)
            }
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // 1. Determine Game Root (Handle legacy "Mods" path)
    let config_path = Path::new(&config.people_playground_dir);
    let game_root = if config_path.ends_with("Mods") || config_path.ends_with("mods") {
        config_path.parent().unwrap_or(config_path)
    } else {
        config_path
    };

    // 2. Classify Content (Mod vs Contraption)
    let download_dir = Path::new(&download_path);
    
    // Check for Mod (mod.json)
    if let Some(mod_json_path) = find_mod_json_recursive(download_dir) {
        // It's a MOD
        let src_root = mod_json_path.parent().unwrap_or(download_dir);
        let dest = game_root.join("Mods").join(&workshop_id_for_move);

        match copy_dir_verified(src_root, &dest) {
            Ok(_) => {
                let _ = fs::remove_dir_all(&download_path);
                Ok(format!("Mod {} installed successfully!", workshop_id_for_move))
            }
            Err(e) => {
                let _ = fs::remove_dir_all(&dest);
                Err(format!("Mod installation failed: {}", e))
            }
        }
    } else if let Some(jaap_path) = find_jaap_recursive(download_dir) {
        // It's a CONTRAPTION
        let src_root = jaap_path.parent().unwrap_or(download_dir);
        
        // Get Name from .json (sibling to .jaap usually) or fallback to ID
        let name = get_contraption_name(src_root).unwrap_or_else(|| workshop_id_for_move.clone());
        let safe_name = sanitize_filename(&name);
        
        let dest = game_root.join("Contraptions").join(&safe_name);

        match copy_dir_verified(src_root, &dest) {
            Ok(_) => {
                let _ = fs::remove_dir_all(&download_path);
                Ok(format!("Contraption '{}' installed successfully!", name))
            }
            Err(e) => {
                let _ = fs::remove_dir_all(&dest);
                Err(format!("Contraption installation failed: {}", e))
            }
        }
    } else {
        Err("Error: Unrecognized content. Missing 'mod.json' or '.jaap' file.".to_string())
    }
}

// ── Validation Helpers ──────────────────────────

fn find_mod_json_recursive(dir: &Path) -> Option<PathBuf> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_mod_json_recursive(&path) {
                    return Some(found);
                }
            } else if let Some(name) = path.file_name() {
                if name.to_string_lossy().eq_ignore_ascii_case("mod.json") {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn find_jaap_recursive(dir: &Path) -> Option<PathBuf> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_jaap_recursive(&path) {
                    return Some(found);
                }
            } else if let Some(ext) = path.extension() {
                if ext.to_string_lossy() == "jaap" {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn get_contraption_name(dir: &Path) -> Option<String> {
    // Look for any .json file and check for "Name" field
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                 if let Ok(contents) = fs::read_to_string(&path) {
                    if let Ok(parsed) = serde_json::from_str::<ModJson>(&contents) {
                        if !parsed.name.is_empty() {
                            return Some(parsed.name);
                        }
                    }
                 }
            }
        }
    }
    None
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

// ── Hashing & Copying ───────────────────────────

fn compute_md5(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut context = md5::Context::new();
    io::copy(&mut file, &mut context).map_err(|e| e.to_string())?;
    let digest = context.compute();
    Ok(format!("{:x}", digest))
}

fn copy_file_verified(src: &Path, dest: &Path) -> Result<(), String> {
    let mut attempts = 0;
    const MAX_ATTEMPTS: i32 = 3;

    loop {
        attempts += 1;
        
        let src_hash = compute_md5(src).map_err(|e| format!("Failed to hash source: {}", e))?;
        
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(src, dest).map_err(|e| format!("Copy failed: {}", e))?;
        
        let dest_hash = compute_md5(dest).map_err(|e| format!("Failed to hash dest: {}", e))?;
        
        if src_hash == dest_hash {
            return Ok(());
        }
        
        println!("Hash mismatch for {:?} (Attempt {}/{})", src.file_name(), attempts, MAX_ATTEMPTS);
        
        if attempts >= MAX_ATTEMPTS {
            return Err(format!("File verification failed after {} attempts", MAX_ATTEMPTS));
        }
        
        let _ = fs::remove_file(dest);
    }
}

fn copy_dir_verified(src: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    }

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_verified(&src_path, &dest_path)?;
        } else {
            copy_file_verified(&src_path, &dest_path)?;
        }
    }
    Ok(())
}

// ── Installed Items ─────────────────────────────

use serde::{Deserialize as SerdeDeserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct InstalledMod {
    pub folder_name: String,
    pub folder_size: u64,
    pub ugc_id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub thumbnail_data: String,
}

#[derive(Debug, Clone, SerdeDeserialize, Default)]
struct ModJson {
    #[serde(default, alias = "Name")]
    name: String,
    #[serde(default, alias = "Author")]
    author: String,
    #[serde(default, alias = "Description")]
    description: String,
    #[serde(default, alias = "CreatorUGCIdentity")]
    creator_ugc_identity: Option<String>,
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

// Reuse parsing logic
fn parse_mod_json(mod_dir: &Path) -> Option<ModJson> {
    if let Ok(entries) = fs::read_dir(mod_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(contents) = fs::read_to_string(&p) {
                    if let Ok(parsed) = serde_json::from_str::<ModJson>(&contents) {
                        return Some(parsed);
                    }
                }
            }
        }
    }
    None
}

fn find_thumbnail(mod_dir: &Path) -> Option<String> {
    if let Ok(entries) = fs::read_dir(mod_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() { continue; }
            let fname = match p.file_name() {
                Some(f) => f.to_string_lossy().to_lowercase(),
                None => continue,
            };
            // Mod thumbnails often "thumb.png". Contraptions imply ".png" same as ".jaap".
            // We'll search for typical image files.
            let is_image = fname.ends_with(".png") || fname.ends_with(".jpg") || fname.ends_with(".jpeg");
            if is_image {
                // Read and return the first image found.
                // Improve priority? Maybe prefer "thumb"?
                // For now, any image is better than none.
                 if let Ok(bytes) = fs::read(&p) {
                     let mime = if fname.ends_with(".png") { "image/png" } else { "image/jpeg" };
                     use base64::Engine;
                     let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                     return Some(format!("data:{};base64,{}", mime, b64));
                }
            }
        }
    }
    None
}

fn is_numeric(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

#[tauri::command]
pub async fn list_installed_mods(
    state: tauri::State<'_, crate::config::ConfigState>,
) -> Result<Vec<InstalledMod>, String> {
    let mods_dir = {
        let config = state.0.lock().unwrap();
        if config.people_playground_dir.is_empty() {
             return Ok(vec![]);
        }
        let p = Path::new(&config.people_playground_dir);
        if p.ends_with("Mods") || p.ends_with("mods") { p.to_path_buf() } else { p.join("Mods") }
    };

    scan_installed_items(&mods_dir)
}

#[tauri::command]
pub async fn list_installed_contraptions(
    state: tauri::State<'_, crate::config::ConfigState>,
) -> Result<Vec<InstalledMod>, String> {
     let contraptions_dir = {
        let config = state.0.lock().unwrap();
        if config.people_playground_dir.is_empty() {
             return Ok(vec![]);
        }
        let p = Path::new(&config.people_playground_dir);
        let root = if p.ends_with("Mods") || p.ends_with("mods") { p.parent().unwrap() } else { p };
        root.join("Contraptions")
    };

    scan_installed_items(&contraptions_dir)
}

fn scan_installed_items(dir: &Path) -> Result<Vec<InstalledMod>, String> {
    if !dir.exists() { return Ok(vec![]); }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for entry in entries.flatten() {
         let dir_path = entry.path();
         if !dir_path.is_dir() { continue; }

         let folder_name = entry.file_name().to_string_lossy().to_string();
         let size = dir_size(&dir_path);
         let json = parse_mod_json(&dir_path);

         let ugc_id = if is_numeric(&folder_name) {
             folder_name.clone()
         } else if let Some(ref j) = json {
             j.creator_ugc_identity.clone().unwrap_or_default()
         } else {
             String::new()
         };

         let name = json.as_ref().map(|j| j.name.clone()).unwrap_or_else(|| folder_name.clone());
         let author = json.as_ref().map(|j| j.author.clone()).unwrap_or_default();
         let description = json.as_ref().map(|j| j.description.clone()).unwrap_or_default();
         let thumbnail_data = find_thumbnail(&dir_path).unwrap_or_default();

         items.push(InstalledMod {
             folder_name, folder_size: size, ugc_id, name, author, description, thumbnail_data
         });
    }
    Ok(items)
}

#[tauri::command]
pub async fn delete_installed_mod(
    state: tauri::State<'_, crate::config::ConfigState>,
    workshop_id: String,
) -> Result<String, String> {
    // This needs to know if it's a mod or contraption?
    // Or we just try to delete from both?
    // Or the frontend passes a path/type?
    // For now assuming ID is either FolderName (Mods) or Name (Contraptions).
    
    let config = state.0.lock().unwrap();
    let p = Path::new(&config.people_playground_dir);
    let root = if p.ends_with("Mods") || p.ends_with("mods") { p.parent().unwrap() } else { p };
    
    let mod_path = root.join("Mods").join(&workshop_id);
    if mod_path.exists() {
        fs::remove_dir_all(&mod_path).map_err(|e| e.to_string())?;
        return Ok(format!("Mod {} deleted.", workshop_id));
    }
    
    let contraption_path = root.join("Contraptions").join(&workshop_id); // Here ID might be Name
    if contraption_path.exists() {
        fs::remove_dir_all(&contraption_path).map_err(|e| e.to_string())?;
        return Ok(format!("Contraption {} deleted.", workshop_id));
    }

    Err(format!("Item '{}' not found in Mods or Contraptions.", workshop_id))
}

#[tauri::command]
pub fn open_mod_folder(folder_name: String) -> Result<(), String> {
    let cfg = crate::config::load_config();
    let config_path = Path::new(&cfg.people_playground_dir);
    let game_root = if config_path.ends_with("Mods") || config_path.ends_with("mods") {
        config_path.parent().unwrap_or(config_path)
    } else {
        config_path
    };

    let path = game_root.join("Mods").join(&folder_name);
    
    if !path.exists() {
        return Err(format!("Folder not found: {:?}", path));
    }

    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn open_contraptions_folder(folder_name: String) -> Result<(), String> {
    let cfg = crate::config::load_config();
    let config_path = Path::new(&cfg.people_playground_dir);
    let game_root = if config_path.ends_with("Mods") || config_path.ends_with("mods") {
        config_path.parent().unwrap_or(config_path)
    } else {
        config_path
    };

    let path = game_root.join("Contraptions").join(&folder_name);
    
    if !path.exists() {
        return Err(format!("Folder not found: {:?}", path));
    }

    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;
    
    Ok(())
}
