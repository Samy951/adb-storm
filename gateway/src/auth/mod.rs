use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub username: String,
    pub exp: usize,
}

/// Validate a JWT token and return the user_id.
pub fn validate_token(token: &str, secret: &str) -> Result<Uuid, String> {
    let validation = Validation::new(Algorithm::HS256);
    let key = DecodingKey::from_secret(secret.as_bytes());

    decode::<Claims>(token, &key, &validation)
        .map(|data| data.claims.sub)
        .map_err(|e| format!("JWT validation failed: {}", e))
}
