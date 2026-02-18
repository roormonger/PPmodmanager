use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

// Helper for "string or number" deserialization
fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct StringOrNumberVisitor;

    impl<'de> serde::de::Visitor<'de> for StringOrNumberVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("string or number")
        }

        fn visit_str<E>(self, value: &str) -> Result<String, E>
        where
            E: serde::de::Error,
        {
            Ok(value.to_owned())
        }

        fn visit_u64<E>(self, value: u64) -> Result<String, E>
        where
            E: serde::de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_i64<E>(self, value: i64) -> Result<String, E>
        where
            E: serde::de::Error,
        {
            Ok(value.to_string())
        }
    }

    deserializer.deserialize_any(StringOrNumberVisitor)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionChild {
    #[serde(default, deserialize_with = "deserialize_string_or_number")]
    pub publishedfileid: String,
    #[serde(default)]
    pub sortorder: u32,
    #[serde(default)]
    pub filetype: u32,
}

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
    #[serde(default, deserialize_with = "deserialize_string_or_number")]
    pub publishedfileid: String,
    #[serde(default)]
    pub result: u32,
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
    pub short_description: String,
    #[serde(default)]
    pub creator: String,
    #[serde(default)]
    pub vote_data: VoteData,
    #[serde(default, rename = "file_type")]
    pub filetype: u32,
    #[serde(default, rename = "consumer_appid")]
    pub consumer_app_id: u32,
    /// Populated after resolving Steam IDs
    #[serde(default)]
    pub creator_name: String,
    #[serde(default)]
    pub children: Vec<CollectionChild>,
    #[serde(default)]
    pub tags: Vec<ModTag>,
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
// Structs defined at top of file


#[derive(Debug, Clone, Deserialize)]
struct CollectionDetailsResponseWrapper {
    response: CollectionDetailsResponse,
}

#[derive(Debug, Clone, Deserialize)]
struct CollectionDetailInner {
    #[serde(default, rename = "publishedfileid")]
    _publishedfileid: String,
    #[serde(default)]
    pub children: Vec<CollectionChild>,
}

#[derive(Debug, Clone, Deserialize)]
struct CollectionDetailsResponse {
    #[serde(default)]
    pub collectiondetails: Vec<CollectionDetailInner>,
}



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
async fn resolve_creator_names(api_key: &str, steam_ids: &[String]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if steam_ids.is_empty() {
        return map;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();
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
    required_tags: Vec<String>,
) -> Result<QueryResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    let mut params: Vec<(&str, String)> = vec![
        ("key", api_key.to_string()),
        ("appid", "1118200".to_string()),
        ("query_type", sort_type.to_string()),
        ("numperpage", num_per_page.to_string()),
        ("return_previews", "true".to_string()),
        ("return_short_description", "true".to_string()),
        ("return_vote_data", "true".to_string()),
        ("strip_description_bbcode", "true".to_string()),
        ("return_tags", "true".to_string()), // Enable tags to verify headers
        ("match_all_tags", "false".to_string()), // Match ANY of the tags
    ];

    if days > 0 {
        params.push(("days", days.to_string()));
    }

    if !query.is_empty() {
        params.push(("search_text", query.to_string()));
    }
    
    // Always pass a cursor. If empty, use "*" to start pagination.
    let cursor_param = if cursor.is_empty() { "*" } else { cursor };
    params.push(("cursor", cursor_param.to_string()));

    // Add tags
    // Loop removed. required_tags are handled by params.push(("requiredtags", ...)) below.
    if !required_tags.is_empty() {
         // Some sources say `requiredtags` is comma separated.
         // Others say it supports multiple keys.
         // Let's go with push("requiredtags", required_tags.join(","))
         // Wait, `reqwest` handles array of tuples.
         // But for `requiredtags` in Steam Web API, it often wants `requiredtags[0]`.
         // HOWEVER, QueryFiles/v1 is valid. 
         // Most implementations use `requiredtags` as a single parameter with comma values?
         // Let's check how `steam_api` crate does it or similar.
         // Official docs are vague.
         // Let's assume comma separated string for now?
         // If it fails, I'll switch to `requiredtags[0]`.
         // But wait, `QueryFiles` takes `requiredtags` as a param.
         // NOTE: `requiredtags` implies MUST HAVE. If `match_all_tags` is false, it means MUST HAVE AT LEAST ONE.
         params.push(("requiredtags", required_tags.join(",")));
    }

    // Retry up to 2 times for transient network errors
    let mut last_err = String::new();
    let mut resp = None;
    for attempt in 0..3 {
        match client
            .get("https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/")
            .query(&params)
            .send()
            .await
        {
            Ok(r) => { resp = Some(r); break; }
            Err(e) => {
                last_err = format!("HTTP request failed: {}", e);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }
    let resp = resp.ok_or(last_err)?;

    if !resp.status().is_success() {
        return Err(format!("Steam API returned status {}", resp.status()));
    }

    // let text = resp.text().await.map_err(|e| format!("Failed to read text: {}", e))?;
    // println!("Raw Steam Response: {}", text); // Debugging

    // let wrapper: ApiWrapper = serde_json::from_str(&text)
    //    .map_err(|e| format!("Failed to parse response: {}", e))?;
    
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
    required_tags: Option<Vec<String>>,
) -> Result<QueryResponse, String> {
    let api_key = {
        let config = state.0.lock().unwrap();
        if config.steam_api_key.is_empty() {
            return Err("Steam API Key not configured. Go to Settings to add it.".to_string());
        }
        config.steam_api_key.clone()
    };

    search_mods(
        &api_key,
        &query,
        &cursor,
        50,
        sort_type.unwrap_or(3),
        days.unwrap_or(7),
        required_tags.unwrap_or_default(),
    )
    .await
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
    #[serde(default, deserialize_with = "deserialize_string_or_number")]
    pub publishedfileid: String,
    #[serde(default)]
    pub result: u32,
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
    #[serde(default)]
    pub children: Vec<CollectionChild>,
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
pub async fn get_multiple_mod_details_cmd(
    state: tauri::State<'_, crate::config::ConfigState>,
    published_file_ids: Vec<String>,
) -> Result<HashMap<String, ModDetail>, String> {
    if published_file_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let api_key = {
        let config = state.0.lock().unwrap();
        if config.steam_api_key.is_empty() {
            return Err("Steam API Key not configured.".to_string());
        }
        config.steam_api_key.clone()
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    // Prepare query parameters
    let mut query_params: Vec<(String, String)> = vec![
        ("key".to_string(), api_key.clone()),
        ("includevotes".to_string(), "true".to_string()),
        ("includetags".to_string(), "true".to_string()),
        ("includeadditionalpreviews".to_string(), "true".to_string()),
        ("includemetadata".to_string(), "true".to_string()),
        ("return_playtime_stats".to_string(), "0".to_string()),
        ("strip_description_bbcode".to_string(), "true".to_string()),
    ];

    for (i, id) in published_file_ids.iter().enumerate() {
        query_params.push((format!("publishedfileids[{}]", i), id.clone()));
    }

    let mut last_err = String::new();
    let mut resp = None;
    for attempt in 0..3 {
        match client
            .get("https://api.steampowered.com/IPublishedFileService/GetDetails/v1/")
            .query(&query_params)
            .send()
            .await
        {
            Ok(r) => { resp = Some(r); break; }
            Err(e) => {
                last_err = format!("Batch HTTP request failed: {}", e);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }
    let resp = resp.ok_or(last_err)?;

    if !resp.status().is_success() {
        return Err(format!("Steam API (Batch) returned status {}", resp.status()));
    }

    let wrapper = resp.json::<DetailWrapper>().await.map_err(|e| format!("Failed to parse batch details: {}", e))?;
    let mut results = HashMap::new();
    for detail in wrapper.response.publishedfiledetails {
        results.insert(detail.publishedfileid.clone(), detail);
    }

    Ok(results)
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    // Retry up to 2 times for transient network errors
    let mut last_err = String::new();
    let mut resp = None;
    for attempt in 0..3 {
        match client
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
        {
            Ok(r) => { resp = Some(r); break; }
            Err(e) => {
                last_err = format!("HTTP request failed: {}", e);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }
    let resp = resp.ok_or(last_err)?;

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

// ── Collections ─────────────────────────────────

/// Search for People Playground workshop collections (filetype=2)
pub async fn search_collections(
    api_key: &str,
    query: &str,
    cursor: &str,
    num_per_page: u32,
    sort_type: u32,
    days: u32,
) -> Result<QueryResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    let mut accumulated_items = Vec::new();
    let mut current_cursor = if cursor.is_empty() { "*".to_string() } else { cursor.to_string() };
    let mut final_total = 0;
    
    // Fetch up to 10 pages to find enough collections (ignoring garbage returned by API)
    for _page_attempt in 0..10 {
        let mut params: Vec<(&str, String)> = vec![
            ("key", api_key.to_string()),
            ("appid", "1118200".to_string()),
            ("query_type", sort_type.to_string()),
            ("filetype", "1".to_string()),   // CONFIRMED: For AppID 1118200, Collections are filetype 1 (not 2)
            ("numperpage", num_per_page.to_string()), 
            ("return_previews", "true".to_string()),
            ("return_short_description", "true".to_string()),
            ("return_vote_data", "true".to_string()),
            ("strip_description_bbcode", "true".to_string()),
            ("return_children", "true".to_string()), 
            ("return_tags", "true".to_string()),
        ];

        if days > 0 {
            params.push(("days", days.to_string()));
        }

        if !query.is_empty() {
             params.push(("search_text", query.to_string()));
        }

        params.push(("cursor", current_cursor.clone()));

        // Retry logic
        let mut last_err = String::new();
        let mut resp = None;
        for attempt in 0..3 {
            match client
                .get("https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/")
                .query(&params)
                .send()
                .await
            {
                Ok(r) => { resp = Some(r); break; }
                Err(e) => {
                    last_err = format!("HTTP request failed: {}", e);
                    if attempt < 2 {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        }
        let resp = resp.ok_or(last_err)?;

        if !resp.status().is_success() {
             return Err(format!("Steam API returned status {}", resp.status()));
        }

        let wrapper: ApiWrapper = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        
        // Filter this page
        let page_items = wrapper.response.publishedfiledetails;
        
        // Filter: Ensure we only show items that are likely collections
        // page_items.retain(|item| item.filetype == 1); // Redundant if we asked for 1
        
        accumulated_items.extend(page_items);
        final_total = wrapper.response.total; 
        current_cursor = wrapper.response.next_cursor;
        
        if accumulated_items.len() >= num_per_page as usize || current_cursor.is_empty() {
            break;
        }
    }

    let mut response = QueryResponse {
        publishedfiledetails: accumulated_items,
        next_cursor: current_cursor,
        total: final_total,
    };

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
pub async fn search_collections_cmd(
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

    // If searching by text and no sort specified, default to Relevance (12) instead of Trend (3)
    let default_sort = if !query.is_empty() { 12 } else { 3 };
    let sort = sort_type.unwrap_or(default_sort);

    search_collections(
        &api_key,
        &query,
        &cursor,
        50,
        sort,
        days.unwrap_or(36500),
    )
    .await
}

// Response structs removed (moved to top)




#[derive(Debug, Clone, Serialize)]
pub struct CollectionFullDetail {
    pub collection: ModDetail,
    pub items: Vec<ModDetail>,
}

#[tauri::command]
pub async fn get_collection_details_cmd(
    state: tauri::State<'_, crate::config::ConfigState>,
    collection_id: String,
) -> Result<CollectionFullDetail, String> {
    let api_key = {
        let config = state.0.lock().unwrap();
        if config.steam_api_key.is_empty() {
            return Err("Steam API Key not configured.".to_string());
        }
        config.steam_api_key.clone()
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    // 1. Get collection metadata (same as mod detail)
    let mut last_err = String::new();
    let mut resp = None;
    for attempt in 0..3 {
        match client
            .get("https://api.steampowered.com/IPublishedFileService/GetDetails/v1/")
            .query(&[
                ("key", api_key.as_str()),
                ("includevotes", "true"),
                ("includetags", "true"),
                ("includeadditionalpreviews", "true"),
                ("strip_description_bbcode", "true"),
                ("includechildren", "true"),
            ])
            .query(&[("publishedfileids[0]", &collection_id)])
            .send()
            .await
        {
            Ok(r) => { resp = Some(r); break; }
            Err(e) => {
                last_err = format!("HTTP request failed: {}", e);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }
    let resp = resp.ok_or(last_err)?;

    if !resp.status().is_success() {
        return Err(format!("Steam API returned status {}", resp.status()));
    }

    let wrapper: DetailWrapper = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse collection detail: {}", e))?;

    let mut collection = wrapper
        .response
        .publishedfiledetails
        .into_iter()
        .next()
        .ok_or_else(|| "Collection not found".to_string())?;

    // Resolve collection creator name
    if !collection.creator.is_empty() {
        let names = resolve_creator_names(&api_key, &[collection.creator.clone()]).await;
        if let Some(name) = names.get(&collection.creator) {
            collection.creator_name = name.clone();
        }
    }

    // 2. Get list of items in the collection via GetCollectionDetails
    let mut last_err2 = String::new();
    let mut resp2 = None;
    for attempt in 0..3 {
        match client
            .post("https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/")
            .form(&[
                ("key", api_key.as_str()),
                ("collectioncount", "1"),
                ("publishedfileids[0]", &collection_id),
            ])
            .send()
            .await
        {
            Ok(r) => { resp2 = Some(r); break; }
            Err(e) => {
                last_err2 = format!("HTTP request failed: {}", e);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }
    let resp2 = resp2.ok_or(last_err2)?;

    if !resp2.status().is_success() {
        return Err(format!("GetCollectionDetails returned status {}", resp2.status()));
    }

    let text = resp2.text().await.map_err(|e| format!("Failed to get text: {}", e))?;
    println!("DEBUG: GetCollectionDetails response: {}", text); 

    let wrapper: CollectionDetailsResponseWrapper = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse collection items: {}, text: {}", e, text))?;

    let children = wrapper.response
        .collectiondetails
        .into_iter()
        .next()
        .map(|c| c.children)
        .unwrap_or_default();

    println!("DEBUG: Found {} children for collection {}", children.len(), collection_id);

    if children.is_empty() {
        return Ok(CollectionFullDetail { collection, items: vec![] });
    }

    // 3. Batch fetch details for all child items
    let child_ids: Vec<String> = children
        .iter()
        // .filter(|c| c.filetype == 0) // Removed filter - trust API or handle in UI
        .map(|c| c.publishedfileid.clone())
        .collect();

    let mut items: Vec<ModDetail> = Vec::new();

    // Steam API supports multiple publishedfileids in one call
    // Process in chunks of 20
    for chunk in child_ids.chunks(20) {
        let indexed: Vec<(String, String)> = chunk
            .iter()
            .enumerate()
            .map(|(i, id)| (format!("publishedfileids[{}]", i), id.clone()))
            .collect();

        let mut resp3 = None;
        for attempt in 0..3 {
            let mut req = client
                .get("https://api.steampowered.com/IPublishedFileService/GetDetails/v1/")
                .query(&[
                    ("key", api_key.as_str()),
                    ("includevotes", "true"),
                    ("includetags", "true"),
                    ("strip_description_bbcode", "true"),
                ]);

            for (k, v) in &indexed {
                req = req.query(&[(k.as_str(), v.as_str())]);
            }

            match req.send().await {
                Ok(r) => { resp3 = Some(r); break; }
                Err(_) if attempt < 2 => {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                Err(_) => {}
            }
        }

        if let Some(resp3) = resp3 {
            if resp3.status().is_success() {
                if let Ok(wrapper) = resp3.json::<DetailWrapper>().await {
                    items.extend(wrapper.response.publishedfiledetails);
                }
            }
        }
    }

    // Resolve creator names for all items
    let unique_ids: Vec<String> = items
        .iter()
        .map(|m| m.creator.clone())
        .filter(|id| !id.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if !unique_ids.is_empty() {
        let names = resolve_creator_names(&api_key, &unique_ids).await;
        for item in &mut items {
            if let Some(name) = names.get(&item.creator) {
                item.creator_name = name.clone();
            }
        }
    }

    Ok(CollectionFullDetail { collection, items })
}
