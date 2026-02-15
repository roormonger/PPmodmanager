use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VoteData {
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub votes_up: u64,
    #[serde(default)]
    pub votes_down: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishedFileDetail {
    #[serde(default)]
    pub publishedfileid: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub preview_url: String,
    #[serde(default)]
    pub time_updated: u64,
    #[serde(default)]
    pub subscriptions: u64,
    #[serde(default)]
    pub favorited: u64,
    #[serde(default)]
    pub file_description: String,
    #[serde(default)]
    pub creator: String,
    #[serde(default)]
    pub vote_data: VoteData,
    /// Populated after resolving Steam IDs
    #[serde(default)]
    pub creator_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResponse {
    #[serde(default)]
    pub publishedfiledetails: Vec<PublishedFileDetail>,
    #[serde(default)]
    pub next_cursor: String,
    #[serde(default)]
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiWrapper {
    response: QueryResponse,
}

// Steam user profile resolution
#[derive(Debug, Clone, Deserialize)]
struct SteamPlayer {
    #[serde(default)]
    steamid: String,
    #[serde(default)]
    personaname: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PlayersResponse {
    players: Vec<SteamPlayer>,
}

#[derive(Debug, Clone, Deserialize)]
struct PlayerSummariesWrapper {
    response: PlayersResponse,
}

/// Batch-resolve Steam IDs to display names
async fn resolve_creator_names(
    api_key: &str,
    steam_ids: &[String],
) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if steam_ids.is_empty() {
        return map;
    }

    let client = reqwest::Client::new();
    // Steam API supports up to 100 IDs per call
    let ids_csv = steam_ids.join(",");
    let resp = client
        .get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/")
        .query(&[("key", api_key), ("steamids", &ids_csv)])
        .send()
        .await;

    if let Ok(resp) = resp {
        if let Ok(wrapper) = resp.json::<PlayerSummariesWrapper>().await {
            for player in wrapper.response.players {
                map.insert(player.steamid, player.personaname);
            }
        }
    }

    map
}

/// Search for People Playground workshop mods
pub async fn search_mods(
    api_key: &str,
    query: &str,
    cursor: &str,
    num_per_page: u32,
    sort_type: u32,
    days: u32,
) -> Result<QueryResponse, String> {
    let client = reqwest::Client::new();

    let mut params: Vec<(&str, String)> = vec![
        ("key", api_key.to_string()),
        ("appid", "1118200".to_string()),
        ("query_type", sort_type.to_string()),
        ("numperpage", num_per_page.to_string()),
        ("return_previews", "true".to_string()),
        ("return_short_description", "true".to_string()),
        ("return_vote_data", "true".to_string()),
        ("strip_description_bbcode", "true".to_string()),
    ];

    if days > 0 {
        params.push(("days", days.to_string()));
    }

    if !query.is_empty() {
        params.push(("search_text", query.to_string()));
    }
    if !cursor.is_empty() {
        params.push(("cursor", cursor.to_string()));
    }

    let resp = client
        .get("https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/")
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Steam API returned status {}", resp.status()));
    }

    let wrapper: ApiWrapper = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let mut response = wrapper.response;

    // Resolve creator names
    let unique_ids: Vec<String> = response
        .publishedfiledetails
        .iter()
        .map(|m| m.creator.clone())
        .filter(|id| !id.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let names = resolve_creator_names(api_key, &unique_ids).await;

    for detail in &mut response.publishedfiledetails {
        if let Some(name) = names.get(&detail.creator) {
            detail.creator_name = name.clone();
        }
    }

    Ok(response)
}

#[tauri::command]
pub async fn search_mods_cmd(
    state: tauri::State<'_, crate::config::ConfigState>,
    query: String,
    cursor: String,
    sort_type: Option<u32>,
    days: Option<u32>,
) -> Result<QueryResponse, String> {
    let api_key = {
        let config = state.0.lock().unwrap();
        if config.steam_api_key.is_empty() {
            return Err("Steam API Key not configured. Go to Settings to add it.".to_string());
        }
        config.steam_api_key.clone()
    };

    search_mods(&api_key, &query, &cursor, 20, sort_type.unwrap_or(3), days.unwrap_or(7)).await
}

// ── Mod Detail ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModPreview {
    #[serde(default)]
    pub previewid: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub preview_type: u32, // 0 = image, 1 = youtube video
    #[serde(default)]
    pub youtubevideoid: String,
    #[serde(default)]
    pub external_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModTag {
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModDetail {
    #[serde(default)]
    pub publishedfileid: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub file_description: String,
    #[serde(default)]
    pub preview_url: String,
    #[serde(default)]
    pub creator: String,
    #[serde(default)]
    pub creator_name: String,
    #[serde(default)]
    pub time_created: u64,
    #[serde(default)]
    pub time_updated: u64,
    #[serde(default)]
    pub file_size: String,
    #[serde(default)]
    pub subscriptions: u64,
    #[serde(default)]
    pub lifetime_subscriptions: u64,
    #[serde(default)]
    pub favorited: u64,
    #[serde(default)]
    pub views: u64,
    #[serde(default)]
    pub vote_data: VoteData,
    #[serde(default)]
    pub tags: Vec<ModTag>,
    #[serde(default)]
    pub previews: Vec<ModPreview>,
}

#[derive(Debug, Clone, Deserialize)]
struct DetailResponse {
    #[serde(default)]
    publishedfiledetails: Vec<ModDetail>,
}

#[derive(Debug, Clone, Deserialize)]
struct DetailWrapper {
    response: DetailResponse,
}

#[tauri::command]
pub async fn get_mod_details_cmd(
    state: tauri::State<'_, crate::config::ConfigState>,
    published_file_id: String,
) -> Result<ModDetail, String> {
    let api_key = {
        let config = state.0.lock().unwrap();
        if config.steam_api_key.is_empty() {
            return Err("Steam API Key not configured.".to_string());
        }
        config.steam_api_key.clone()
    };

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.steampowered.com/IPublishedFileService/GetDetails/v1/")
        .query(&[
            ("key", api_key.as_str()),
            ("includevotes", "true"),
            ("includetags", "true"),
            ("includeadditionalpreviews", "true"),
            ("includemetadata", "true"),
            ("return_playtime_stats", "0"),
            ("strip_description_bbcode", "true"),
        ])
        .query(&[("publishedfileids[0]", &published_file_id)])
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Steam API returned status {}", resp.status()));
    }

    let wrapper: DetailWrapper = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let mut detail = wrapper
        .response
        .publishedfiledetails
        .into_iter()
        .next()
        .ok_or_else(|| "Mod not found".to_string())?;

    // Resolve creator name
    if !detail.creator.is_empty() {
        let names = resolve_creator_names(&api_key, &[detail.creator.clone()]).await;
        if let Some(name) = names.get(&detail.creator) {
            detail.creator_name = name.clone();
        }
    }

    Ok(detail)
}
