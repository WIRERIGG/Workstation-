use wiredash_db::Database;
use wiredash_db::kv::KvStore;
use crate::types::Token;

pub struct TokenManager<'a> {
    kv: KvStore<'a>,
}

impl<'a> TokenManager<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { kv: KvStore::new(db) }
    }

    pub fn get_token(&self) -> Result<Option<Token>, anyhow::Error> {
        self.kv.read_as::<Token>("token")
    }

    pub fn save_token(&self, token: &Token) -> Result<(), anyhow::Error> {
        let mut stamped = token.clone();
        stamped.t = chrono::Utc::now().timestamp_millis();
        self.kv.write("token", &serde_json::to_value(&stamped)?)
    }

    pub fn delete_token(&self) -> Result<(), anyhow::Error> {
        self.kv.delete("token")
    }

    pub fn get_access_token_no_refresh(&self) -> Result<Option<String>, anyhow::Error> {
        match self.get_token()? {
            Some(t) if !t.is_expired() => Ok(Some(t.access_token)),
            _ => Ok(None),
        }
    }
}
