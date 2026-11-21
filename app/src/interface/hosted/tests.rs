use super::*;

const HOST: &str = "192.168.1.20:47392";
/// A source on this machine where nothing listens: its check fails at once, offline.
const URL: &str = "http://127.0.0.1:9/api/v2.0/indexers/all/results/torznab/api";

fn call(method: &str, path: &str, session: Option<&str>, body: &str) -> Response {
    handle(&Request { method, path, host: Some(HOST), session, body })
}

/// The settings loaded from a fresh data dir, and the lock every test of the process-wide
/// settings, pairing and catalog takes.
fn setup(name: &str) -> (std::sync::MutexGuard<'static, ()>, std::path::PathBuf) {
    let guard = catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join(format!("reel-hosted-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    settings::load(Some(&dir), &[]);
    PAIRING.lock().unwrap().cancel();
    (guard, dir)
}

/// Pairs as the page does: asks for a code, reads it off the "screen", types it.
fn pair() -> String {
    let started = call("POST", "/settings/api/pair", None, "");
    assert_eq!(started.status, 200, "{:?}", started.body);
    let id = started.body["pairing"].as_str().unwrap().to_owned();
    let code = pairing()["code"].as_str().unwrap().to_owned();
    let done = call("POST", "/settings/api/pair/confirm", None, &json!({ "pairing": id, "code": code }).to_string());
    assert_eq!(done.status, 200, "{:?}", done.body);
    done.body["session"].as_str().unwrap().to_owned()
}

#[test]
fn open_without_a_session_while_pairing_is_off() {
    let (_g, dir) = setup("nosession");
    // PAIRING_REQUIRED is off for now (docs/todo.md): the page works as it opens.
    let state = call("GET", "/settings/api/state", None, "");
    assert_eq!(state.status, 200);
    assert!(state.body["bufferChoices"].is_array());
    assert_eq!(call("POST", "/settings/api/buffer", None, "{\"mb\": 1}").status, 400, "still checked");
    // Never the key, paired or not.
    assert!(state.body["source"].get("key").is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_code_shows_on_the_screen_until_it_is_typed() {
    let (_g, dir) = setup("pairing");
    assert_eq!(pairing(), json!({ "code": null }));
    let rev = settings::revision();
    let started = call("POST", "/settings/api/pair", None, "");
    assert_eq!(started.body["expiresIn"], 120);
    assert!(settings::revision() > rev, "the screen hears of the code");
    let shown = pairing();
    let code = shown["code"].as_str().unwrap().to_owned();
    assert_eq!(code.len(), 6);
    assert!(!started.body.to_string().contains(&code), "the page never gets the code");

    let id = started.body["pairing"].as_str().unwrap();
    let wrong = if code == "000000" { "111111" } else { "000000" };
    let r = call("POST", "/settings/api/pair/confirm", None, &json!({ "pairing": id, "code": wrong }).to_string());
    assert_eq!((r.status, r.body.clone()), (403, json!({ "error": "wrong_code", "attemptsLeft": 4 })));
    assert_eq!(pairing()["code"], code.as_str(), "one wrong try keeps the code");

    let rev = settings::revision();
    let r = call("POST", "/settings/api/pair/confirm", None, &json!({ "pairing": id, "code": code }).to_string());
    assert_eq!(r.status, 200);
    assert_eq!(pairing(), json!({ "code": null }));
    assert!(settings::revision() > rev, "the screen hears the code is gone");
    let session = r.body["session"].as_str().unwrap();
    assert_eq!(call("GET", "/settings/api/state", Some(session), "").status, 200);

    // Used, the pairing is over.
    let again = call("POST", "/settings/api/pair/confirm", None, &json!({ "pairing": id, "code": code }).to_string());
    assert_eq!((again.status, again.body), (410, json!({ "error": "expired" })));
    // A body that is not the right JSON.
    assert_eq!(call("POST", "/settings/api/pair/confirm", None, "nope").status, 400);
    assert_eq!(call("GET", "/settings/api/pair", None, "").status, 405);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn back_on_the_screen_cancels_the_code() {
    let (_g, dir) = setup("cancel");
    let started = call("POST", "/settings/api/pair", None, "");
    let code = pairing()["code"].as_str().unwrap().to_owned();
    let rev = settings::revision();
    cancel_pairing();
    assert!(settings::revision() > rev);
    assert_eq!(pairing(), json!({ "code": null }));
    let id = started.body["pairing"].as_str().unwrap();
    let r = call("POST", "/settings/api/pair/confirm", None, &json!({ "pairing": id, "code": code }).to_string());
    assert_eq!(r.status, 410);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_key_never_comes_back() {
    let (_g, dir) = setup("key");
    let s = pair();
    let saved = call("POST", "/settings/api/source", Some(&s), &json!({ "url": URL, "key": "s3cr3t-key" }).to_string());
    assert_eq!(saved.status, 200, "{:?}", saved.body);
    assert_eq!(saved.body["source"], json!({ "url": URL, "hasKey": true }));
    assert!(saved.body["check"].as_u64().unwrap() > 0);
    let state = call("GET", "/settings/api/state", Some(&s), "");
    assert!(!state.body.to_string().contains("s3cr3t"));
    assert_eq!(settings::source().unwrap().key.as_deref(), Some("s3cr3t-key"));

    // An empty key keeps the saved one; removeKey clears it.
    call("POST", "/settings/api/source", Some(&s), &json!({ "url": URL, "key": "" }).to_string());
    assert_eq!(settings::source().unwrap().key.as_deref(), Some("s3cr3t-key"));
    call("POST", "/settings/api/source", Some(&s), &json!({ "url": URL }).to_string());
    assert_eq!(settings::source().unwrap().key.as_deref(), Some("s3cr3t-key"));
    let removed = call("POST", "/settings/api/source", Some(&s), &json!({ "url": URL, "removeKey": true }).to_string());
    assert_eq!(removed.body["source"]["hasKey"], false);
    assert_eq!(settings::source().unwrap().key, None);

    // A key inside the address is cut out of what the page sees; sending that back keeps it.
    let with_key = format!("{URL}?apikey=inurl-secret&t=caps");
    call("POST", "/settings/api/source", Some(&s), &json!({ "url": with_key }).to_string());
    let state = call("GET", "/settings/api/state", Some(&s), "");
    assert!(!state.body.to_string().contains("inurl-secret"), "{}", state.body);
    let shown = state.body["source"]["url"].as_str().unwrap().to_owned();
    call("POST", "/settings/api/source", Some(&s), &json!({ "url": shown }).to_string());
    assert_eq!(settings::source().unwrap().url, with_key);
    settings::set_source("", "").unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn writes_are_checked_and_reach_the_tv() {
    let (_g, dir) = setup("writes");
    let s = pair();
    let rev = settings::revision();

    let bad = call("POST", "/settings/api/source", Some(&s), &json!({ "url": "ftp://nas/api" }).to_string());
    assert_eq!(bad.status, 400);
    assert_eq!(bad.body["ok"], false);
    assert!(bad.body["message"].as_str().unwrap().contains("http://"));
    assert!(settings::source().is_none(), "a refused address is not saved");

    let ok = call("POST", "/settings/api/source", Some(&s), &json!({ "url": URL }).to_string());
    assert!(settings::revision() > rev, "the TV hears of the new source");
    let check = ok.body["check"].as_u64().unwrap();
    let r = call("GET", &format!("/settings/api/check/{check}"), Some(&s), "");
    assert_eq!(r.status, 200);
    assert!(["pending", "failed"].contains(&r.body["state"].as_str().unwrap()), "{}", r.body);
    assert_eq!(call("GET", &format!("/settings/api/check/{}", check + 1000), Some(&s), "").status, 404, "only its own checks");

    assert_eq!(call("POST", "/settings/api/language", Some(&s), r#"{"tag":"xx-XX"}"#).status, 400);
    let l = call("POST", "/settings/api/language", Some(&s), r#"{"tag":"pl-PL"}"#);
    assert_eq!(l.body, json!({ "contentLanguage": "pl-PL" }));
    assert_eq!(settings::content_language(), "pl-PL");
    settings::set_content_language(settings::DEFAULT_CONTENT_LANGUAGE);

    assert_eq!(call("POST", "/settings/api/buffer", Some(&s), r#"{"mb":333}"#).status, 400);
    let smallest = settings::buffer_choices()[0];
    let b = call("POST", "/settings/api/buffer", Some(&s), &json!({ "mb": smallest }).to_string());
    assert_eq!(b.body, json!({ "bufferMB": smallest }));
    let state = call("GET", "/settings/api/state", Some(&s), "").body;
    assert_eq!(state["bufferMB"], smallest);
    assert_eq!(state["bufferChoices"], settings::current()["bufferChoices"]);
    assert_eq!(state["contentLanguages"].as_array().unwrap().len(), settings::CONTENT_LANGUAGES.len());
    assert!(state.get("streamDetails").is_none() && state.get("language").is_none(), "only what the page sets");

    assert_eq!(call("DELETE", "/settings/api/state", Some(&s), "").status, 405);
    assert_eq!(call("GET", "/settings/api/nope", Some(&s), "").status, 404);
    settings::set_buffer_mb(settings::DEFAULT_BUFFER_MB);
    settings::set_source("", "").unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn only_an_ip_address_as_the_host() {
    let (_g, dir) = setup("host");
    for host in ["192.168.1.20:47392", "192.168.1.20", "[fe80::1]:47392", "127.0.0.1:47392"] {
        assert!(host_is_ip(host), "{host}");
    }
    for host in ["evil.example:47392", "localhost:47392", "tv.local", ""] {
        assert!(!host_is_ip(host), "{host}");
        let r = handle(&Request { method: "POST", path: "/settings/api/pair", host: Some(host), session: None, body: "" });
        assert_eq!((r.status, r.body), (403, json!({ "error": "host" })));
    }
    let r = handle(&Request { method: "POST", path: "/settings/api/pair", host: None, session: None, body: "" });
    assert_eq!(r.status, 403);
    assert_eq!(pairing(), json!({ "code": null }), "no code for a refused request");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn not_ready_until_the_settings_are_loaded() {
    let (_g, dir) = setup("ready");
    settings::forget_loaded_for_test();
    let r = call("POST", "/settings/api/pair", None, "");
    assert_eq!((r.status, r.body), (503, json!({ "error": "not_ready" })));
    settings::load(Some(&dir), &[]);
    assert_eq!(call("POST", "/settings/api/pair", None, "").status, 200);
    cancel_pairing();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_address_shows_only_where_the_page_is_served() {
    let (_g, dir) = setup("address");
    serving_on(0);
    assert_eq!(address(), json!({ "url": null }));
    serving_on(47392);
    // Null on a machine without a network; else this machine's address.
    if let Some(url) = address()["url"].as_str() {
        assert!(url.starts_with("http://") && url.ends_with(":47392/settings"), "{url}");
        assert!(!url.contains("127.0.0.1"));
    }
    serving_on(0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_page_is_self_contained() {
    assert!(PAGE.starts_with("<!doctype html>"));
    for outside in ["src=\"http", "href=\"http", "@import", "url(http", "<link"] {
        assert!(!PAGE.contains(outside), "the page loads nothing from elsewhere ({outside})");
    }
    assert!(PAGE.len() < 24 * 1024, "small: {} bytes", PAGE.len());
}

#[test]
fn a_link_that_opened_the_app_is_offered_to_the_screen() {
    let (_g, dir) = setup("offer-link");
    *OFFERS.lock().unwrap() = Default::default();
    let link = format!("reel://s?t=rented-key&u={}", URL.replace(':', "%3A").replace('/', "%2F"));
    assert!(!offer_link("reel://other"), "a link without a source offers nothing");
    assert_eq!(offered()["host"], Value::Null);
    assert!(offer_link(&link));
    assert_eq!(offered()["host"], "127.0.0.1");
    assert!(settings::source().is_none(), "nothing saved before the yes");
    answer_offer(true);
    assert_eq!(settings::source().unwrap().key.as_deref(), Some("rented-key"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_source_offered_from_a_link_is_saved_only_after_a_yes_on_the_screen() {
    let (_g, dir) = setup("offer");
    *OFFERS.lock().unwrap() = Default::default();
    // No pairing: the link from the bot carries none.
    let made = call("POST", "/settings/api/offer", None, &json!({ "url": URL, "key": "rented-key" }).to_string());
    assert_eq!(made.status, 200, "{:?}", made.body);
    let id = made.body["offer"].as_str().unwrap().to_owned();
    assert_eq!(offered()["host"], "127.0.0.1");
    assert!(settings::source().is_none(), "nothing saved before the yes");
    assert_eq!(call("GET", &format!("/settings/api/offer/{id}"), None, "").body["state"], "pending");
    assert!(!offered().to_string().contains("rented-key"), "the screen never sees the key");

    answer_offer(true);
    assert_eq!(settings::source().unwrap().key.as_deref(), Some("rented-key"));
    let s = call("GET", &format!("/settings/api/offer/{id}"), None, "");
    assert_eq!(s.body["state"], "accepted");
    assert!(s.body["result"]["state"].is_string(), "the check's answer: {}", s.body);
    assert_eq!(offered()["host"], Value::Null);

    // A no saves nothing; a bad address is refused at once.
    settings::set_source("", "").unwrap();
    std::thread::sleep(offer::SPACING);
    let id = call("POST", "/settings/api/offer", None, &json!({ "url": URL, "key": "x" }).to_string()).body["offer"].as_str().unwrap().to_owned();
    answer_offer(false);
    assert!(settings::source().is_none());
    assert_eq!(call("GET", &format!("/settings/api/offer/{id}"), None, "").body["state"], "declined");
    std::thread::sleep(offer::SPACING);
    assert_eq!(call("POST", "/settings/api/offer", None, &json!({ "url": "ftp://x" }).to_string()).status, 400);
    let _ = std::fs::remove_dir_all(&dir);
}
