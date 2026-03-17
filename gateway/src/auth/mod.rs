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

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};

    const TEST_SECRET: &str = "test-secret-key";

    fn make_token(sub: Uuid, username: &str, exp: usize, secret: &str) -> String {
        let claims = Claims {
            sub,
            username: username.to_string(),
            exp,
        };
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    fn future_exp() -> usize {
        // 1 hour from now
        (chrono::Utc::now().timestamp() as usize) + 3600
    }

    fn past_exp() -> usize {
        // 1 hour ago
        (chrono::Utc::now().timestamp() as usize) - 3600
    }

    #[test]
    fn valid_token_returns_user_id() {
        let user_id = Uuid::new_v4();
        let token = make_token(user_id, "alice", future_exp(), TEST_SECRET);

        let result = validate_token(&token, TEST_SECRET);
        assert_eq!(result.unwrap(), user_id);
    }

    #[test]
    fn expired_token_returns_error() {
        let user_id = Uuid::new_v4();
        let token = make_token(user_id, "alice", past_exp(), TEST_SECRET);

        let result = validate_token(&token, TEST_SECRET);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JWT validation failed"));
    }

    #[test]
    fn wrong_secret_returns_error() {
        let user_id = Uuid::new_v4();
        let token = make_token(user_id, "alice", future_exp(), "correct-secret");

        let result = validate_token(&token, "wrong-secret");
        assert!(result.is_err());
    }

    #[test]
    fn invalid_token_string_returns_error() {
        let result = validate_token("not-a-jwt-token", TEST_SECRET);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JWT validation failed"));
    }

    #[test]
    fn empty_token_returns_error() {
        let result = validate_token("", TEST_SECRET);
        assert!(result.is_err());
    }

    #[test]
    fn valid_token_preserves_username_in_claims() {
        let user_id = Uuid::new_v4();
        let token = make_token(user_id, "bob", future_exp(), TEST_SECRET);

        let validation = Validation::new(Algorithm::HS256);
        let key = DecodingKey::from_secret(TEST_SECRET.as_bytes());
        let data = decode::<Claims>(&token, &key, &validation).unwrap();

        assert_eq!(data.claims.username, "bob");
        assert_eq!(data.claims.sub, user_id);
    }
}
