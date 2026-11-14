//! What a title screen shows below the hero: the cast with their photos, the
//! people behind it grouped by job, the age rating for the viewer's region,
//! every score with its source, the details (release date, countries,
//! studios, status). Data and decisions only; the words are the UI's.

use serde_json::{Value, json};

use super::{image_url, text, votes, ymd};

/// Cast photos: TMDB's w185 profile size (AniList's large one).
const PHOTO_W: u32 = 185;
/// How many of the cast the row shows.
const CAST: usize = 20;
/// Names per crew job.
const PER_JOB: usize = 3;

fn list(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}

/// "Keanu Reeves" → "KR", "Zendaya" → "Z": the placeholder without a photo.
pub fn initials(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let pick = |w: Option<&&str>| w.and_then(|w| w.chars().next()).into_iter().flat_map(char::to_uppercase);
    match words.len() {
        0 => String::new(),
        1 => pick(words.first()).collect(),
        _ => pick(words.first()).chain(pick(words.last())).collect(),
    }
}

/// `[{"name","character","photo","initials"}]`, billing order, first 20.
pub fn cast(credits: &Value) -> Vec<Value> {
    let mut people: Vec<&Value> = list(credits).iter().filter(|c| c["role"] == "cast").collect();
    people.sort_by_key(|c| c["order"].as_u64().unwrap_or(u64::MAX));
    people
        .into_iter()
        .take(CAST)
        .filter_map(|c| {
            let name = text(&c["name"])?;
            Some(json!({
                "name": name,
                "character": text(&c["character"]),
                "photo": image_url(&c["profile"], PHOTO_W),
                "initials": initials(&name),
            }))
        })
        .collect()
}

/// The crew line's group a source's job belongs to (keys under `crew.*`).
fn job_key(job: &str) -> Option<&'static str> {
    Some(match job {
        "Director" => "director",
        "Creator" | "Original Creator" => "creator",
        "Screenplay" | "Writer" | "Series Composition" => "writer",
        "Novel" => "novel",
        "Original Music Composer" | "Music" => "music",
        _ => return None,
    })
}

/// `[{"job","names":[…]}]`: a film's director, writers, the novel and the
/// music; a series' creators and music (its directors change by episode).
pub fn crew(credits: &Value, show: bool) -> Vec<Value> {
    let order: &[&str] = if show { &["creator", "music"] } else { &["director", "writer", "novel", "music"] };
    order
        .iter()
        .filter_map(|&key| {
            let mut names: Vec<String> = Vec::new();
            for c in list(credits).iter().filter(|c| c["role"] == "crew") {
                let (Some(job), Some(name)) = (c["job"].as_str(), text(&c["name"])) else { continue };
                if job_key(job) == Some(key) && !names.contains(&name) && names.len() < PER_JOB {
                    names.push(name);
                }
            }
            (!names.is_empty()).then(|| json!({ "job": key, "names": names }))
        })
        .collect()
}

/// The viewer's region from the UI language: its region subtag ("pl-PL"),
/// else where the language is mainly spoken, else the US.
pub fn region(lang: &str) -> String {
    let mut parts = lang.split(['-', '_']);
    let primary = parts.next().unwrap_or("").to_ascii_lowercase();
    if let Some(r) = parts.find(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_alphabetic())) {
        return r.to_ascii_uppercase();
    }
    let r = match primary.as_str() {
        "pl" => "PL",
        "de" => "DE",
        "fr" => "FR",
        "es" => "ES",
        "it" => "IT",
        "pt" => "BR",
        "nl" => "NL",
        "sv" => "SE",
        "da" => "DK",
        "nb" | "no" => "NO",
        "fi" => "FI",
        "cs" => "CZ",
        "uk" => "UA",
        "ru" => "RU",
        "tr" => "TR",
        "ja" => "JP",
        "ko" => "KR",
        "zh" => "CN",
        _ => "US",
    };
    r.to_owned()
}

/// The age rating for `lang`'s region, else the US one.
pub fn certification(certs: &Value, lang: &str) -> Option<String> {
    let of = |country: &str| list(certs).iter().find(|c| c["country"] == country).and_then(|c| text(&c["rating"]));
    of(&region(lang)).or_else(|| of("US"))
}

/// Every score with its source in its own scale: `[{"source","value","votes"}]`,
/// TMDB "8.0", AniList "85%", MAL "8.54"; votes "4.8K" (empty when unknown).
pub fn ratings(ratings: &Value) -> Vec<Value> {
    ["tmdb", "anilist", "mal"]
        .iter()
        .filter_map(|&source| {
            let r = list(ratings).iter().find(|r| r["source"] == source)?;
            let value = r["value"].as_f64().filter(|v| *v > 0.0)?;
            let value = match source {
                "anilist" => format!("{}%", value.round()),
                "mal" => format!("{value:.2}"),
                _ => format!("{value:.1}"),
            };
            Some(json!({ "source": source, "value": value, "votes": r["votes"].as_u64().map(votes).unwrap_or_default() }))
        })
        .collect()
}

/// The details block: `{"tagline","originalTitle","releaseDate":[y,m,d],
/// "countries":[name…],"studios":[…],"status"}` (`status` a key under
/// `status.*`, for series only).
pub fn details(t: &Value, show: bool) -> Value {
    let countries: Vec<String> = list(&t["countries"]).iter().filter_map(|c| c.as_str()).map(country).collect();
    let studios: Vec<String> = list(&t["studios"]).iter().filter_map(text).take(4).collect();
    json!({
        "tagline": text(&t["tagline"]),
        "originalTitle": text(&t["originalTitle"]),
        "releaseDate": ymd(&t["release"]["date"]),
        "countries": countries,
        "studios": studios,
        "status": if show { t["status"].clone() } else { Value::Null },
    })
}

/// A country's English name by its ISO code (the code where it is not listed).
pub fn country(code: &str) -> String {
    let name = match code {
        "US" => "United States",
        "GB" => "United Kingdom",
        "CA" => "Canada",
        "AU" => "Australia",
        "NZ" => "New Zealand",
        "IE" => "Ireland",
        "FR" => "France",
        "DE" => "Germany",
        "IT" => "Italy",
        "ES" => "Spain",
        "PT" => "Portugal",
        "NL" => "Netherlands",
        "BE" => "Belgium",
        "CH" => "Switzerland",
        "AT" => "Austria",
        "SE" => "Sweden",
        "NO" => "Norway",
        "DK" => "Denmark",
        "FI" => "Finland",
        "IS" => "Iceland",
        "PL" => "Poland",
        "CZ" => "Czechia",
        "SK" => "Slovakia",
        "HU" => "Hungary",
        "RO" => "Romania",
        "BG" => "Bulgaria",
        "GR" => "Greece",
        "UA" => "Ukraine",
        "RU" => "Russia",
        "TR" => "Turkey",
        "IL" => "Israel",
        "IN" => "India",
        "CN" => "China",
        "HK" => "Hong Kong",
        "TW" => "Taiwan",
        "JP" => "Japan",
        "KR" => "South Korea",
        "TH" => "Thailand",
        "ID" => "Indonesia",
        "PH" => "Philippines",
        "MX" => "Mexico",
        "BR" => "Brazil",
        "AR" => "Argentina",
        "CL" => "Chile",
        "CO" => "Colombia",
        "ZA" => "South Africa",
        "EG" => "Egypt",
        "NG" => "Nigeria",
        "IR" => "Iran",
        "AE" => "United Arab Emirates",
        _ => return code.to_owned(),
    };
    name.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initials_of_names() {
        assert_eq!(initials("Keanu Reeves"), "KR");
        assert_eq!(initials("Carrie-Anne Moss"), "CM");
        assert_eq!(initials("Zendaya"), "Z");
        assert_eq!(initials("井上麻里奈"), "井");
        assert_eq!(initials(""), "");
    }

    #[test]
    fn regions_and_age_ratings() {
        assert_eq!(region("pl-PL"), "PL");
        assert_eq!(region("pt"), "BR");
        assert_eq!(region("en"), "US");
        assert_eq!(region("en-GB"), "GB");
        let certs = json!([{ "country": "US", "rating": "R" }, { "country": "DE", "rating": "16" }]);
        assert_eq!(certification(&certs, "de").as_deref(), Some("16"));
        assert_eq!(certification(&certs, "pl-PL").as_deref(), Some("R"), "no Polish one: the US one");
        assert_eq!(certification(&json!([{ "country": "JP", "rating": "R15+" }]), "en"), None);
    }

    #[test]
    fn scores_with_their_sources() {
        let r = json!([
            { "source": "tmdb", "value": 8.04, "scale": 10.0, "votes": 4800 },
            { "source": "mal", "value": 8.544, "scale": 10.0, "votes": 2_400_000 },
            { "source": "anilist", "value": 85.0, "scale": 100.0, "votes": null },
        ]);
        assert_eq!(
            json!(ratings(&r)),
            json!([
                { "source": "tmdb", "value": "8.0", "votes": "4.8K" },
                { "source": "anilist", "value": "85%", "votes": "" },
                { "source": "mal", "value": "8.54", "votes": "2.4M" },
            ])
        );
    }
}
