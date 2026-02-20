use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

/// Baked into each customer build at compile time.
const LICENSE_SECRET: &str = "zeroclaw-default-secret-replace-in-prod";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseClaims {
    pub sub: String,            // customer ID
    pub business_name: String,
    pub plan: String,           // "starter" | "pro" | "pro_plus"
    pub max_daily_tokens: i64,
    pub exp: usize,
}

#[derive(Debug, Clone)]
pub struct LicenseInfo {
    pub customer_id: String,
    pub business_name: String,
    pub plan: String,
    pub max_daily_tokens: i64,
}

impl Default for LicenseInfo {
    fn default() -> Self {
        Self {
            customer_id: "demo".into(),
            business_name: "ZeroClaw Demo".into(),
            plan: "starter".into(),
            max_daily_tokens: 100_000,
        }
    }
}

/// Load the license JWT from the embedded constant or environment.
/// Falls back to demo license if not found or invalid.
pub fn load_license() -> anyhow::Result<LicenseInfo> {
    let token = std::env::var("ZEROCLAW_LICENSE_JWT")
        .unwrap_or_default();

    if token.is_empty() {
        log::info!("No license JWT found, using demo license");
        return Ok(LicenseInfo::default());
    }

    let key = DecodingKey::from_secret(LICENSE_SECRET.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;

    let data = decode::<LicenseClaims>(&token, &key, &validation)?;

    Ok(LicenseInfo {
        customer_id: data.claims.sub,
        business_name: data.claims.business_name,
        plan: data.claims.plan,
        max_daily_tokens: data.claims.max_daily_tokens,
    })
}

/// Generate a license JWT (used by the vendor build script).
pub fn generate_license(
    customer_id: &str,
    business_name: &str,
    plan: &str,
    max_daily_tokens: i64,
    expires_days: i64,
) -> anyhow::Result<String> {
    use jsonwebtoken::{encode, EncodingKey, Header};

    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(expires_days))
        .unwrap()
        .timestamp() as usize;

    let claims = LicenseClaims {
        sub: customer_id.into(),
        business_name: business_name.into(),
        plan: plan.into(),
        max_daily_tokens,
        exp,
    };

    let key = EncodingKey::from_secret(LICENSE_SECRET.as_bytes());
    let token = encode(&Header::default(), &claims, &key)?;
    Ok(token)
}
