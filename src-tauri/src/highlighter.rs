use serde::Serialize;
use syntect::highlighting::ThemeSet;
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;

#[derive(Serialize)]
pub struct HighlightResult {
    pub html: String,
    pub language: String,
}

#[tauri::command]
pub fn highlight_code(
    code: String,
    language: Option<String>,
    theme: Option<String>,
) -> Result<HighlightResult, String> {
    let ss = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();

    let theme_name = theme.as_deref().unwrap_or("base16-ocean.dark");
    let theme = ts
        .themes
        .get(theme_name)
        .or_else(|| ts.themes.values().next())
        .ok_or("No themes available")?;

    let syntax = if let Some(ref lang) = language {
        ss.find_syntax_by_token(lang)
            .or_else(|| ss.find_syntax_by_extension(lang))
    } else {
        None
    }
    .unwrap_or_else(|| ss.find_syntax_plain_text());

    let lang = syntax.name.clone();
    let html =
        highlighted_html_for_string(&code, &ss, syntax, theme).map_err(|e| e.to_string())?;

    Ok(HighlightResult {
        html,
        language: lang,
    })
}

#[tauri::command]
pub fn list_languages() -> Vec<String> {
    let ss = SyntaxSet::load_defaults_newlines();
    ss.syntaxes().iter().map(|s| s.name.clone()).collect()
}

#[tauri::command]
pub fn list_themes() -> Vec<String> {
    let ts = ThemeSet::load_defaults();
    ts.themes.keys().cloned().collect()
}
