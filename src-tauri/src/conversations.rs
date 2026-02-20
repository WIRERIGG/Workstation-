use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone)]
pub struct ConversationSession {
    pub id: String,
    pub tool: String,
    pub title: Option<String>,
    pub project: Option<String>,
    pub started_at: String,
    pub messages: usize,
    pub tokens: Option<u64>,
    pub cost: Option<f64>,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    pub timestamp: Option<String>,
    pub tool_use: Option<String>,
}

#[derive(Serialize)]
pub struct ConversationDetail {
    pub session: ConversationSession,
    pub messages: Vec<ConversationMessage>,
}

/// Scan standard locations for AI conversation files
fn get_conversation_dirs() -> Vec<(String, PathBuf)> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    vec![
        // Claude Code
        (
            "claude-code".to_string(),
            home.join(".claude").join("projects"),
        ),
        // Cursor
        (
            "cursor".to_string(),
            home.join(".cursor").join("conversations"),
        ),
        // Gemini CLI
        (
            "gemini".to_string(),
            home.join(".gemini").join("conversations"),
        ),
        // GitHub Copilot
        (
            "copilot".to_string(),
            home.join(".copilot").join("conversations"),
        ),
    ]
}

#[tauri::command]
pub fn conversations_scan(
    tool_filter: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ConversationSession>, String> {
    let limit = limit.unwrap_or(100);
    let dirs = get_conversation_dirs();
    let mut sessions = Vec::new();

    for (tool, dir) in &dirs {
        if let Some(ref filter) = tool_filter {
            if tool != filter {
                continue;
            }
        }

        if !dir.exists() {
            continue;
        }

        // Scan for JSONL files (Claude Code format)
        if let Ok(entries) = glob::glob(&format!("{}/**/*.jsonl", dir.display())) {
            for entry in entries.flatten() {
                if let Some(session) = parse_session_metadata(&entry, tool) {
                    sessions.push(session);
                }
            }
        }

        // Scan for JSON files (other formats)
        if let Ok(entries) = glob::glob(&format!("{}/**/*.json", dir.display())) {
            for entry in entries.flatten() {
                if let Some(session) = parse_session_metadata(&entry, tool) {
                    sessions.push(session);
                }
            }
        }
    }

    // Sort by started_at descending
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    sessions.truncate(limit);

    Ok(sessions)
}

#[tauri::command]
pub fn conversations_search(
    query: String,
    tool_filter: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ConversationSession>, String> {
    let all = conversations_scan(tool_filter, None)?;
    let query_lower = query.to_lowercase();
    let limit = limit.unwrap_or(20);

    let filtered: Vec<ConversationSession> = all
        .into_iter()
        .filter(|s| {
            s.title
                .as_ref()
                .map(|t| t.to_lowercase().contains(&query_lower))
                .unwrap_or(false)
                || s.project
                    .as_ref()
                    .map(|p| p.to_lowercase().contains(&query_lower))
                    .unwrap_or(false)
        })
        .take(limit)
        .collect();

    Ok(filtered)
}

#[tauri::command]
pub fn conversations_get_session(path: String) -> Result<ConversationDetail, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Session file not found: {}", path));
    }

    let content = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let tool = detect_tool_from_path(file_path);

    if path.ends_with(".jsonl") {
        parse_jsonl_session(&content, &path, &tool)
    } else {
        parse_json_session(&content, &path, &tool)
    }
}

fn parse_session_metadata(path: &Path, tool: &str) -> Option<ConversationSession> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    let started_at = chrono::DateTime::from_timestamp(modified.as_secs() as i64, 0)?
        .to_rfc3339();

    // Extract project name from path
    let project = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string());

    let file_name = path
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Count lines for JSONL (rough message count)
    let messages = if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
        std::fs::read_to_string(path)
            .ok()
            .map(|c| c.lines().count())
            .unwrap_or(0)
    } else {
        0
    };

    Some(ConversationSession {
        id: file_name,
        tool: tool.to_string(),
        title: None,
        project,
        started_at,
        messages,
        tokens: None,
        cost: None,
        path: path.to_string_lossy().to_string(),
    })
}

fn detect_tool_from_path(path: &Path) -> String {
    let path_str = path.to_string_lossy().to_lowercase();
    if path_str.contains(".claude") {
        "claude-code".to_string()
    } else if path_str.contains(".cursor") {
        "cursor".to_string()
    } else if path_str.contains(".gemini") {
        "gemini".to_string()
    } else if path_str.contains(".copilot") {
        "copilot".to_string()
    } else {
        "unknown".to_string()
    }
}

fn parse_jsonl_session(
    content: &str,
    path: &str,
    tool: &str,
) -> Result<ConversationDetail, String> {
    let mut messages = Vec::new();
    let mut title = None;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let role = val["role"]
                .as_str()
                .or_else(|| val["type"].as_str())
                .unwrap_or("unknown")
                .to_string();

            let msg_content = val["content"]
                .as_str()
                .or_else(|| val["message"].as_str())
                .unwrap_or("")
                .to_string();

            // Extract title from first user message
            if title.is_none() && role == "user" && !msg_content.is_empty() {
                title = Some(msg_content.chars().take(80).collect::<String>());
            }

            let tool_use = val["tool_use"]
                .as_str()
                .or_else(|| val["tool"].as_str())
                .map(|s| s.to_string());

            messages.push(ConversationMessage {
                role,
                content: msg_content,
                timestamp: val["timestamp"].as_str().map(|s| s.to_string()),
                tool_use,
            });
        }
    }

    let session = ConversationSession {
        id: Path::new(path)
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        tool: tool.to_string(),
        title,
        project: Path::new(path)
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_string()),
        started_at: messages
            .first()
            .and_then(|m| m.timestamp.clone())
            .unwrap_or_default(),
        messages: messages.len(),
        tokens: None,
        cost: None,
        path: path.to_string(),
    };

    Ok(ConversationDetail { session, messages })
}

fn parse_json_session(
    content: &str,
    path: &str,
    tool: &str,
) -> Result<ConversationDetail, String> {
    let val: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;

    let title = val["title"]
        .as_str()
        .or_else(|| val["name"].as_str())
        .map(|s| s.to_string());

    let raw_messages = val["messages"]
        .as_array()
        .or_else(|| val["conversation"].as_array())
        .cloned()
        .unwrap_or_default();

    let messages: Vec<ConversationMessage> = raw_messages
        .iter()
        .map(|m| ConversationMessage {
            role: m["role"].as_str().unwrap_or("unknown").to_string(),
            content: m["content"].as_str().unwrap_or("").to_string(),
            timestamp: m["timestamp"].as_str().map(|s| s.to_string()),
            tool_use: m["tool_use"].as_str().map(|s| s.to_string()),
        })
        .collect();

    let session = ConversationSession {
        id: Path::new(path)
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        tool: tool.to_string(),
        title,
        project: val["project"].as_str().map(|s| s.to_string()),
        started_at: val["created_at"]
            .as_str()
            .or_else(|| val["started_at"].as_str())
            .unwrap_or("")
            .to_string(),
        messages: messages.len(),
        tokens: val["total_tokens"].as_u64(),
        cost: val["total_cost"].as_f64(),
        path: path.to_string(),
    };

    Ok(ConversationDetail { session, messages })
}

#[derive(Serialize)]
pub struct ConversationStats {
    pub total_sessions: usize,
    pub total_messages: usize,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub by_tool: Vec<ToolStats>,
}

#[derive(Serialize)]
pub struct ToolStats {
    pub tool: String,
    pub sessions: usize,
    pub messages: usize,
    pub tokens: u64,
    pub cost: f64,
}

#[tauri::command]
pub fn conversations_export(path: String) -> Result<String, String> {
    let detail = conversations_get_session(path)?;
    let mut md = String::new();

    md.push_str(&format!("# {}\n\n", detail.session.title.as_deref().unwrap_or("Untitled Session")));
    md.push_str(&format!("- **Tool**: {}\n", detail.session.tool));
    md.push_str(&format!("- **Project**: {}\n", detail.session.project.as_deref().unwrap_or("N/A")));
    md.push_str(&format!("- **Started**: {}\n", detail.session.started_at));
    md.push_str(&format!("- **Messages**: {}\n\n", detail.session.messages));
    md.push_str("---\n\n");

    for msg in &detail.messages {
        let role_header = match msg.role.as_str() {
            "user" => "## User",
            "assistant" => "## Assistant",
            _ => "## System",
        };
        md.push_str(role_header);

        if let Some(ts) = &msg.timestamp {
            md.push_str(&format!(" _{}_", ts));
        }
        md.push('\n');

        if let Some(tool) = &msg.tool_use {
            md.push_str(&format!("\n`[Tool: {}]`\n", tool));
        }

        md.push('\n');
        md.push_str(&msg.content);
        md.push_str("\n\n---\n\n");
    }

    Ok(md)
}

#[tauri::command]
pub fn conversations_stats(tool_filter: Option<String>) -> Result<ConversationStats, String> {
    let sessions = conversations_scan(tool_filter, Some(10000))?;
    let mut by_tool_map: std::collections::HashMap<String, ToolStats> = std::collections::HashMap::new();

    let mut total_messages = 0usize;
    let mut total_tokens = 0u64;
    let mut total_cost = 0.0f64;

    for session in &sessions {
        total_messages += session.messages;
        total_tokens += session.tokens.unwrap_or(0);
        total_cost += session.cost.unwrap_or(0.0);

        let entry = by_tool_map.entry(session.tool.clone()).or_insert_with(|| ToolStats {
            tool: session.tool.clone(),
            sessions: 0,
            messages: 0,
            tokens: 0,
            cost: 0.0,
        });
        entry.sessions += 1;
        entry.messages += session.messages;
        entry.tokens += session.tokens.unwrap_or(0);
        entry.cost += session.cost.unwrap_or(0.0);
    }

    let by_tool: Vec<ToolStats> = by_tool_map.into_values().collect();

    Ok(ConversationStats {
        total_sessions: sessions.len(),
        total_messages,
        total_tokens,
        total_cost,
        by_tool,
    })
}
