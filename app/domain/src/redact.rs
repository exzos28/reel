//! Errors and addresses as someone off the device may see them.

use std::sync::LazyLock;

/// An error as the viewer may see it: no keys, no long links.
pub fn redact(message: &str) -> String {
    static URL: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(https?)://([^/\s?]+)[^\s]*").unwrap());
    URL.replace_all(&redact_keys(message), "$1://$2/…").into_owned()
}

/// `text` with the values of key-like parameters cut out (`apikey=…`), links kept whole.
pub fn redact_keys(text: &str) -> String {
    static KEY: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)\b((?:jackett_)?api_?key|passkey|pk|token)=[^&\s]+").unwrap());
    KEY.replace_all(text, "$1=…").into_owned()
}

#[cfg(test)]
mod tests {
    #[test]
    fn errors_hide_keys_and_links() {
        let m = "GET http://127.0.0.1:9117/dl/rutracker/?jackett_apikey=z53secret&path=Q2Z&file=x returned 302 Found";
        let r = super::redact(m);
        assert!(!r.contains("z53secret") && !r.contains("path=Q2Z"), "{r}");
        assert!(r.contains("http://127.0.0.1:9117/…"), "{r}");
        assert_eq!(super::redact("announce?pk=abc&x=1"), "announce?pk=…&x=1");
    }
}
