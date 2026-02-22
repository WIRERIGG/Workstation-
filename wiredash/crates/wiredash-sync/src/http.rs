use reqwest::Client;
use crate::types::*;
use crate::token::TokenManager;

pub struct HttpClient<'a> {
    client: Client,
    token_manager: &'a TokenManager<'a>,
}

impl<'a> HttpClient<'a> {
    pub fn new(token_manager: &'a TokenManager<'a>) -> Self {
        Self {
            client: Client::new(),
            token_manager,
        }
    }

    pub async fn get_access_token(&self) -> Result<String, SyncError> {
        let token = self.token_manager.get_token()
            .map_err(|e: anyhow::Error| SyncError::Database(e))?
            .ok_or(SyncError::TokenExpired)?;

        if !token.is_expired() {
            return Ok(token.access_token);
        }

        if !token.is_refreshable() {
            return Err(SyncError::TokenExpired);
        }

        let refresh_token = token.refresh_token.clone();
        let scope = token.scope.clone();

        let params = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("scope", scope.as_str()),
            ("client_id", CLIENT_ID),
        ];

        let resp = self.client
            .post(format!("{}/connect/token", AUTH_HOST))
            .form(&params)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(SyncError::TokenExpired);
        }

        let token_resp: TokenResponse = resp.json().await?;
        let new_token = Token {
            access_token: token_resp.access_token,
            refresh_token: token_resp.refresh_token.unwrap_or(refresh_token),
            expires_in: token_resp.expires_in.unwrap_or(3600),
            t: chrono::Utc::now().timestamp_millis(),
            scope: token_resp.scope.unwrap_or(scope),
        };

        self.token_manager.save_token(&new_token)
            .map_err(|e: anyhow::Error| SyncError::Database(e))?;

        Ok(new_token.access_token)
    }

    pub async fn get(&self, url: &str) -> Result<reqwest::Response, SyncError> {
        let token = self.get_access_token().await?;
        Ok(self.client.get(url).bearer_auth(&token).send().await?)
    }

    pub async fn post_form(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> Result<reqwest::Response, SyncError> {
        let token = self.get_access_token().await?;
        Ok(self.client.post(url).bearer_auth(&token).form(params).send().await?)
    }

    pub async fn post_json<T: serde::Serialize>(
        &self,
        url: &str,
        body: &T,
    ) -> Result<reqwest::Response, SyncError> {
        let token = self.get_access_token().await?;
        Ok(self.client.post(url).bearer_auth(&token).json(body).send().await?)
    }

    pub async fn post_form_unauth(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> Result<reqwest::Response, SyncError> {
        Ok(self.client.post(url).form(params).send().await?)
    }

    pub async fn post_form_with_token(
        &self,
        url: &str,
        params: &[(&str, &str)],
        bearer: &str,
    ) -> Result<reqwest::Response, SyncError> {
        Ok(self.client.post(url).bearer_auth(bearer).form(params).send().await?)
    }

    pub fn inner(&self) -> &Client {
        &self.client
    }
}
