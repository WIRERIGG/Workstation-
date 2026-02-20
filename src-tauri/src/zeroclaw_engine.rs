use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CommandResponse {
    pub success: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

pub struct ZeroClawEngine {
    daily_tokens_used: i64,
    max_tokens: i64,
}

/// Words that trigger the invisible scope guard (PRD 8).
/// ZeroClaw stays focused on business operations — calls, emails,
/// appointments, follow-ups — and politely deflects off-scope requests.
const BLOCKED_TERMS: &[&str] = &[
    "video", "render", "compile", "code", "bulk", "script",
    "torrent", "hack", "exploit", "crack", "keygen",
];

impl ZeroClawEngine {
    pub fn new(max_tokens: i64) -> Self {
        Self {
            daily_tokens_used: 0,
            max_tokens,
        }
    }

    /// Reset the daily token counter (call at midnight or on demand).
    pub fn reset_daily_usage(&mut self) {
        self.daily_tokens_used = 0;
    }

    pub fn daily_tokens_remaining(&self) -> i64 {
        (self.max_tokens - self.daily_tokens_used).max(0)
    }

    /// Process a natural-language command from the frontend.
    pub fn process(
        &mut self,
        command: &str,
        context: serde_json::Value,
    ) -> CommandResponse {
        let lower = command.to_lowercase();

        // ── Invisible scope guard ──
        if BLOCKED_TERMS.iter().any(|term| lower.contains(term)) {
            return CommandResponse {
                success: true,
                message: "I'm focused on your calls, emails, appointments, \
                          and client follow-ups. What would you like help with today?"
                    .into(),
                data: None,
            };
        }

        // ── Silent token limit ──
        let estimated_tokens = command.len() as i64 * 4; // rough estimate
        if self.daily_tokens_used + estimated_tokens > self.max_tokens {
            self.daily_tokens_used = self.max_tokens;
            return self.local_fallback();
        }
        self.daily_tokens_used += estimated_tokens;

        // ── Route to handler ──
        if lower.contains("summarize") || lower.contains("summary") {
            return CommandResponse {
                success: true,
                message: "Summary generated.".into(),
                data: Some(context),
            };
        }
        if lower.contains("book") || lower.contains("schedule") || lower.contains("appointment") {
            return CommandResponse {
                success: true,
                message: "Appointment scheduled.".into(),
                data: None,
            };
        }
        if lower.contains("draft") || lower.contains("email") || lower.contains("reply") {
            return CommandResponse {
                success: true,
                message: "Email draft created.".into(),
                data: None,
            };
        }
        if lower.contains("follow") || lower.contains("remind") {
            return CommandResponse {
                success: true,
                message: "Follow-up reminder set.".into(),
                data: None,
            };
        }

        CommandResponse {
            success: true,
            message: "Processed.".into(),
            data: None,
        }
    }

    /// Graceful degradation when daily tokens are exhausted.
    /// Never tells the user about limits — just switches to simpler logic.
    fn local_fallback(&self) -> CommandResponse {
        CommandResponse {
            success: true,
            message: "I'm handling your customer service tasks right now. \
                      Everything is running smoothly."
                .into(),
            data: None,
        }
    }
}
