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

    // Find mod.json (Gatekeeper)
    let download_dir = Path::new(&download_path);
    let mod_json_path = find_mod_json_recursive(download_dir)
        .ok_or_else(|| "Error: This mod is invalid (missing mod.json). It cannot be installed.".to_string())?;
    
    // Use the directory containing mod.json as the root source
    let src_root = mod_json_path.parent().unwrap_or(download_dir);

    // Target (Mods/WorkshopID)
    let dest = Path::new(&config.people_playground_dir).join(&workshop_id_for_move);
    
    // Copy with verification (Atomic Check-Copy-Check)
    // We do NOT use move_dir here because we want to verify.
    // Also we are copying from potentially a subfolder.
    
    match copy_dir_verified(src_root, &dest) {
        Ok(_) => {
            // Success! Cleanup the download folder
            let _ = fs::remove_dir_all(&download_path);
            Ok(format!("Mod {} installed successfully!", workshop_id_for_move))
        }
        Err(e) => {
            // Failed. Cleanup destination to avoid partial install
            let _ = fs::remove_dir_all(&dest);
            Err(format!("Installation failed during verification: {}", e))
        }
    }
}

// ── Validation Logic ────────────────────────────

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
        
        // 1. Hash Source
        let src_hash = compute_md5(src).map_err(|e| format!("Failed to hash source: {}", e))?;
        
        // 2. Copy
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(src, dest).map_err(|e| format!("Copy failed: {}", e))?;
        
        // 3. Hash Dest
        let dest_hash = compute_md5(dest).map_err(|e| format!("Failed to hash dest: {}", e))?;
        
        // 4. Compare
        if src_hash == dest_hash {
            return Ok(());
        }
        
        // Mismatch
        println!("Hash mismatch for {:?} (Attempt {}/{})", src.file_name(), attempts, MAX_ATTEMPTS);
        
        if attempts >= MAX_ATTEMPTS {
            return Err(format!("File verification failed after {} attempts for {:?}", MAX_ATTEMPTS, src.file_name()));
        }
        
        // Delete bad copy and retry
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

// ── Installed Mods ──────────────────────────────

use serde::{Deserialize as SerdeDeserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct InstalledMod {
    pub folder_name: String,
    pub folder_size: u64,
    /// Workshop ID: either folder name (if numeric) or CreatorUGCIdentity from JSON
    pub ugc_id: String,
    /// Mod name from JSON, or folder name as fallback
    pub name: String,
    /// Author from mod JSON
    pub author: String,
    /// Description from mod JSON
    pub description: String,
    /// Base64 data URL for local thumbnail (thumb*.png/jpg)
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

/// Find and parse the first .json file in a mod folder
fn parse_mod_json(mod_dir: &Path) -> Option<ModJson> {
    if let Ok(entries) = fs::read_dir(mod_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(contents) = fs::read_to_string(&p) {
                    if let Ok(parsed) = serde_json::from_str::<ModJson>(&contents) {
                        if !parsed.name.is_empty() {
                            return Some(parsed);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Find a thumbnail file matching thumb*.png or thumb*.jpg (case-insensitive)
fn find_thumbnail(mod_dir: &Path) -> Option<String> {
    if let Ok(entries) = fs::read_dir(mod_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let fname = match p.file_name() {
                Some(f) => f.to_string_lossy().to_lowercase(),
                None => continue,
            };
            let is_image =
                fname.ends_with(".png") || fname.ends_with(".jpg") || fname.ends_with(".jpeg");
            if is_image && fname.starts_with("thumb") {
                // Read and base64 encode
                if let Ok(bytes) = fs::read(&p) {
                    let mime = if fname.ends_with(".png") {
                        "image/png"
                    } else {
                        "image/jpeg"
                    };
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
            return Err("Mods folder not set. Go to Settings to configure it.".to_string());
        }
        config.people_playground_dir.clone()
    };

    let path = Path::new(&mods_dir);
    if !path.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read mods folder: {}", e))?;

    let mut mods = Vec::new();
    for entry in entries.flatten() {
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let size = dir_size(&dir_path);

        // Parse mod JSON if present
        let mod_json = parse_mod_json(&dir_path);

        // Determine workshop/UGC ID
        let ugc_id = if is_numeric(&folder_name) {
            // Folder name IS the workshop ID
            folder_name.clone()
        } else if let Some(ref json) = mod_json {
            // Use CreatorUGCIdentity from JSON
            json.creator_ugc_identity.clone().unwrap_or_default()
        } else {
            String::new()
        };

        // Get name, author, description from JSON or fallback
        let name = mod_json
            .as_ref()
            .map(|j| j.name.clone())
            .unwrap_or_else(|| folder_name.clone());
        let author = mod_json
            .as_ref()
            .map(|j| j.author.clone())
            .unwrap_or_default();
        let description = mod_json
            .as_ref()
            .map(|j| j.description.clone())
            .unwrap_or_default();

        // Find local thumbnail
        let thumbnail_data = find_thumbnail(&dir_path).unwrap_or_default();

        mods.push(InstalledMod {
            folder_name,
            folder_size: size,
            ugc_id,
            name,
            author,
            description,
            thumbnail_data,
        });
    }

    Ok(mods)
}

#[tauri::command]
pub async fn delete_installed_mod(
    state: tauri::State<'_, crate::config::ConfigState>,
    workshop_id: String,
) -> Result<String, String> {
    let mods_dir = {
        let config = state.0.lock().unwrap();
        if config.people_playground_dir.is_empty() {
            return Err("Mods folder not set.".to_string());
        }
        config.people_playground_dir.clone()
    };

    let mod_path = Path::new(&mods_dir).join(&workshop_id);
    if !mod_path.exists() {
        return Err(format!("Mod folder '{}' not found.", workshop_id));
    }

    fs::remove_dir_all(&mod_path).map_err(|e| format!("Failed to delete mod: {}", e))?;

    Ok(format!("Mod {} deleted.", workshop_id))
}
