use near_sdk::env;
use near_sdk::serde_json::{json, Value};

/// NEP-297 event under Bearer's own standard. NFT mint and transfer events
/// come from near-contract-standards with `standard: "nep171"`.
pub fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "bearer",
        "version": "3.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
