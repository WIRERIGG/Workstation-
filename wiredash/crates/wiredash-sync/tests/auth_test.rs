use wiredash_sync::auth::AuthClient;
use wiredash_sync::types::*;

#[test]
fn test_build_email_params() {
    let params = AuthClient::email_params("user@test.com");
    assert_eq!(params.len(), 3);
    assert_eq!(params[0], ("email", "user@test.com".to_string()));
    assert_eq!(params[1], ("grant_type", "email".to_string()));
    assert_eq!(params[2], ("client_id", CLIENT_ID.to_string()));
}

#[test]
fn test_build_password_params() {
    let params = AuthClient::password_params("hashed_pw_base64");
    assert_eq!(params.len(), 4);
    assert_eq!(params[0], ("grant_type", "mfa_password".to_string()));
    assert_eq!(params[1], ("client_id", CLIENT_ID.to_string()));
    assert_eq!(params[2], ("scope", "workstation.sync offline_access IdentityServerApi".to_string()));
    assert_eq!(params[3], ("password", "hashed_pw_base64".to_string()));
}

#[test]
fn test_build_mfa_params() {
    let params = AuthClient::mfa_params("123456", "app");
    assert_eq!(params.len(), 4);
    assert_eq!(params[0], ("grant_type", "mfa".to_string()));
    assert_eq!(params[1], ("client_id", CLIENT_ID.to_string()));
    assert_eq!(params[2], ("mfa:code", "123456".to_string()));
    assert_eq!(params[3], ("mfa:method", "app".to_string()));
}

#[test]
fn test_build_signup_params() {
    let params = AuthClient::signup_params("user@test.com", "hashed");
    assert_eq!(params.len(), 3);
    assert_eq!(params[0], ("email", "user@test.com".to_string()));
    assert_eq!(params[1], ("password", "hashed".to_string()));
    assert_eq!(params[2], ("client_id", CLIENT_ID.to_string()));
}

#[test]
fn test_parse_token_response() {
    let json = r#"{
        "access_token": "jwt-abc",
        "refresh_token": "ref-def",
        "expires_in": 3600,
        "scope": "workstation.sync offline_access IdentityServerApi"
    }"#;
    let resp: TokenResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.access_token, "jwt-abc");
    assert_eq!(resp.refresh_token.as_deref(), Some("ref-def"));
    assert_eq!(resp.expires_in, Some(3600));
}

#[test]
fn test_token_response_to_token() {
    let resp = TokenResponse {
        access_token: "a".into(),
        refresh_token: Some("r".into()),
        expires_in: Some(1800),
        scope: Some("workstation.sync".into()),
        additional_data: None,
    };
    let token = AuthClient::token_response_to_token(&resp);
    assert_eq!(token.access_token, "a");
    assert_eq!(token.refresh_token, "r");
    assert_eq!(token.expires_in, 1800);
    assert!(token.t > 0);
}
