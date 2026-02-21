use crate::http::HttpClient;
use crate::types::*;
use wiredash_crypto::password::Password;

pub struct AuthClient;

impl AuthClient {
    pub fn email_params(email: &str) -> Vec<(&'static str, String)> {
        vec![
            ("email", email.to_string()),
            ("grant_type", "email".to_string()),
            ("client_id", CLIENT_ID.to_string()),
        ]
    }

    pub fn password_params(hashed_password: &str) -> Vec<(&'static str, String)> {
        vec![
            ("grant_type", "mfa_password".to_string()),
            ("client_id", CLIENT_ID.to_string()),
            ("scope", "workstation.sync offline_access IdentityServerApi".to_string()),
            ("password", hashed_password.to_string()),
        ]
    }

    pub fn mfa_params(code: &str, method: &str) -> Vec<(&'static str, String)> {
        vec![
            ("grant_type", "mfa".to_string()),
            ("client_id", CLIENT_ID.to_string()),
            ("mfa:code", code.to_string()),
            ("mfa:method", method.to_string()),
        ]
    }

    pub fn signup_params(email: &str, hashed_password: &str) -> Vec<(&'static str, String)> {
        vec![
            ("email", email.to_string()),
            ("password", hashed_password.to_string()),
            ("client_id", CLIENT_ID.to_string()),
        ]
    }

    pub fn refresh_params(refresh_token: &str, scope: &str) -> Vec<(&'static str, String)> {
        vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.to_string()),
            ("scope", scope.to_string()),
            ("client_id", CLIENT_ID.to_string()),
        ]
    }

    pub fn token_response_to_token(resp: &TokenResponse) -> Token {
        Token {
            access_token: resp.access_token.clone(),
            refresh_token: resp.refresh_token.clone().unwrap_or_default(),
            expires_in: resp.expires_in.unwrap_or(3600),
            t: chrono::Utc::now().timestamp_millis(),
            scope: resp.scope.clone().unwrap_or_default(),
        }
    }

    pub async fn login_email<'a>(
        http: &HttpClient<'a>,
        email: &str,
    ) -> Result<(Token, Option<serde_json::Value>), SyncError> {
        let params = Self::email_params(email);
        let str_params: Vec<(&str, &str)> = params.iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let token_url = format!("{}/connect/token", AUTH_HOST);
        let resp = http.post_form_unauth(&token_url, &str_params).await?;

        if !resp.status().is_success() {
            let err: ErrorResponse = resp.json().await
                .unwrap_or(ErrorResponse { error: "unknown".into(), error_description: None });
            return Err(SyncError::AuthFailed(
                err.error_description.unwrap_or(err.error),
            ));
        }

        let token_resp: TokenResponse = resp.json().await?;
        let additional = token_resp.additional_data.clone();
        let token = Self::token_response_to_token(&token_resp);
        Ok((token, additional))
    }

    pub async fn login_mfa<'a>(
        http: &HttpClient<'a>,
        bearer: &str,
        code: &str,
        method: &str,
    ) -> Result<Token, SyncError> {
        let params = Self::mfa_params(code, method);
        let str_params: Vec<(&str, &str)> = params.iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let token_url = format!("{}/connect/token", AUTH_HOST);
        let resp = http.post_form_with_token(&token_url, &str_params, bearer).await?;

        if !resp.status().is_success() {
            let err: ErrorResponse = resp.json().await
                .unwrap_or(ErrorResponse { error: "unknown".into(), error_description: None });
            return Err(SyncError::AuthFailed(
                err.error_description.unwrap_or(err.error),
            ));
        }

        let token_resp: TokenResponse = resp.json().await?;
        Ok(Self::token_response_to_token(&token_resp))
    }

    pub async fn login_password<'a>(
        http: &HttpClient<'a>,
        bearer: &str,
        password: &str,
        email: &str,
    ) -> Result<Token, SyncError> {
        let hashed = Password::hash(password, email)
            .map_err(SyncError::Crypto)?;

        let params = Self::password_params(&hashed);
        let str_params: Vec<(&str, &str)> = params.iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let token_url = format!("{}/connect/token", AUTH_HOST);
        let resp = http.post_form_with_token(&token_url, &str_params, bearer).await?;

        if !resp.status().is_success() {
            let err: ErrorResponse = resp.json().await
                .unwrap_or(ErrorResponse { error: "unknown".into(), error_description: None });
            return Err(SyncError::AuthFailed(
                err.error_description.unwrap_or(err.error),
            ));
        }

        let token_resp: TokenResponse = resp.json().await?;
        Ok(Self::token_response_to_token(&token_resp))
    }

    pub async fn get_user<'a>(http: &HttpClient<'a>) -> Result<User, SyncError> {
        let url = format!("{}/users", API_HOST);
        let resp = http.get(&url).await?;

        if !resp.status().is_success() {
            return Err(SyncError::AuthFailed("failed to fetch user profile".into()));
        }

        Ok(resp.json().await?)
    }

    pub async fn register_device<'a>(
        http: &HttpClient<'a>,
        device_id: &str,
    ) -> Result<(), SyncError> {
        let url = format!("{}/devices?deviceId={}", API_HOST, device_id);
        let resp = http.post_form(&url, &[]).await?;

        if !resp.status().is_success() {
            return Err(SyncError::AuthFailed("device registration failed".into()));
        }

        Ok(())
    }
}
