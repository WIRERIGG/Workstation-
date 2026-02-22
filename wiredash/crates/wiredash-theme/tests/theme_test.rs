use wiredash_theme::colors::parse_hex;
use wiredash_theme::defaults;
use wiredash_theme::ColorScheme;

#[test]
fn test_parse_hex_rrggbb() {
    let c = parse_hex("#E00000").unwrap();
    assert!((c.r - 0.878).abs() < 0.01);
    assert!((c.g - 0.0).abs() < 0.01);
    assert!((c.b - 0.0).abs() < 0.01);
}

#[test]
fn test_parse_hex_rgb_short() {
    let c = parse_hex("#fff").unwrap();
    assert!((c.r - 1.0).abs() < 0.01);
    assert!((c.g - 1.0).abs() < 0.01);
    assert!((c.b - 1.0).abs() < 0.01);
}

#[test]
fn test_parse_hex_with_alpha() {
    let c = parse_hex("#0000001a").unwrap();
    assert!((c.r - 0.0).abs() < 0.01);
    assert!((c.a - 0.102).abs() < 0.02);
}

#[test]
fn test_parse_hex_invalid() {
    assert!(parse_hex("not-a-color").is_none());
    assert!(parse_hex("#GG0000").is_none());
}

#[test]
fn test_default_light_theme() {
    let theme = defaults::default_light();
    assert_eq!(theme.color_scheme, ColorScheme::Light);
    assert_eq!(theme.scopes.base.primary.accent, "#E00000");
    let iced = theme.to_iced_theme();
    let _ = format!("{:?}", iced);
}

#[test]
fn test_default_dark_theme() {
    let theme = defaults::default_dark();
    assert_eq!(theme.color_scheme, ColorScheme::Dark);
    assert_eq!(theme.scopes.base.primary.background, "#1e1e1e");
}

#[test]
fn test_theme_from_json_roundtrip() {
    let theme = defaults::default_light();
    let json = serde_json::to_string(&theme).unwrap();
    let parsed: wiredash_theme::ThemeDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.name, "Workstation Light");
    assert_eq!(parsed.scopes.base.primary.accent, "#E00000");
}

#[test]
fn test_nav_colors_fallback() {
    let mut theme = defaults::default_light();
    let nav = theme.nav_colors();
    assert_eq!(nav.background, "#f8f8f8");
    theme.scopes.navigation_menu = None;
    let nav = theme.nav_colors();
    assert_eq!(nav.background, "#ffffff");
}

#[test]
fn test_theme_engine() {
    let mut engine = wiredash_theme::ThemeEngine::new();
    assert_eq!(engine.active_definition().color_scheme, ColorScheme::Light);
    engine.toggle_scheme();
    assert_eq!(engine.active_definition().color_scheme, ColorScheme::Dark);
    engine.toggle_scheme();
    assert_eq!(engine.active_definition().color_scheme, ColorScheme::Light);
}
