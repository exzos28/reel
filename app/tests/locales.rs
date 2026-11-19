//! Every translation in locales/ has exactly en.yml's keys, with the same `%{placeholders}` in
//! each text: a missing key would show in English, an extra one is dead, and a lost placeholder
//! drops a value. The files are rust-i18n's plain YAML (nested maps of texts, two-space indent),
//! read line by line here.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// The texts of a locale file by their dotted keys ("player.stage.found.one").
fn texts(path: &Path) -> BTreeMap<String, String> {
    let src = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let mut parents: Vec<(usize, String)> = Vec::new();
    let mut out = BTreeMap::new();
    for (n, line) in src.lines().enumerate() {
        let body = line.trim_start();
        if body.is_empty() || body.starts_with('#') {
            continue;
        }
        let indent = line.len() - body.len();
        let (key, value) = if let Some(rest) = body.strip_prefix('"') {
            let end = rest.find('"').unwrap_or_else(|| panic!("{}:{}: unclosed key", path.display(), n + 1));
            let value = rest[end + 1..].strip_prefix(':').unwrap_or_else(|| panic!("{}:{}: no colon", path.display(), n + 1));
            (&rest[..end], value)
        } else {
            body.split_once(':').unwrap_or_else(|| panic!("{}:{}: not a key", path.display(), n + 1))
        };
        parents.retain(|(i, _)| *i < indent);
        let full = parents.iter().map(|(_, k)| k.as_str()).chain([key]).collect::<Vec<_>>().join(".");
        let value = value.trim();
        if value.is_empty() {
            parents.push((indent, key.to_owned()));
        } else {
            out.insert(full, value.to_owned());
        }
    }
    out
}

fn placeholders(text: &str) -> BTreeSet<&str> {
    text.match_indices("%{").filter_map(|(i, _)| text[i..].find('}').map(|j| &text[i + 2..i + j])).collect()
}

#[test]
fn every_locale_has_the_english_keys_and_placeholders() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("locales");
    let en = texts(&dir.join("en.yml"));
    assert!(en.len() > 100, "en.yml read as {} texts", en.len());
    let mut others = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "yml") || path.file_name().is_some_and(|n| n == "en.yml") {
            continue;
        }
        others += 1;
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let other = texts(&path);
        let missing: Vec<_> = en.keys().filter(|k| !other.contains_key(*k)).collect();
        let extra: Vec<_> = other.keys().filter(|k| !en.contains_key(*k)).collect();
        assert!(missing.is_empty() && extra.is_empty(), "{name}: missing {missing:?}, not in en.yml {extra:?}");
        for (key, text) in &en {
            assert_eq!(placeholders(&other[key]), placeholders(text), "{name}: the placeholders of {key}");
        }
    }
    assert!(others > 0, "no translations next to en.yml");
}
