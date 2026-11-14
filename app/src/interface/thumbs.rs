//! Smaller copies of providers' pictures, for a TV. Some sources have one size only (AniList's
//! banners are 1900 px wide); a TV decoding dozens of those for 326 px cards stalls for most
//! of a second at a time. On a TV the catalog points such pictures at the core instead
//! (`catalog::thumb_url`), which answers `/img` with a card's 16:9 copy `width` px wide (`get`), kept on disk:
//! cut from the middle as the card's `cover` would, so a banner is not stretched up.
//! Only the image hosts the catalog uses: the core is no proxy for anything else.

use std::hash::{Hash, Hasher};
use std::path::PathBuf;

/// The hosts whose pictures the core shrinks.
const HOSTS: &[&str] = &["s4.anilist.co", "image.tmdb.org", "cdn.myanimelist.net"];
/// The widths it makes.
const WIDTHS: &[u32] = &[300, 500, 780];

fn allowed(src: &str, width: u32) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(src).map_err(|e| format!("not an address: {e}"))?;
    if u.scheme() != "https" || !u.host_str().is_some_and(|h| HOSTS.contains(&h)) {
        return Err("not a picture of a known source".into());
    }
    if !WIDTHS.contains(&width) {
        return Err(format!("width {width} is not one of {WIDTHS:?}"));
    }
    Ok(u)
}

fn cache_file(src: &str, width: u32) -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (src, width).hash(&mut h);
    std::env::temp_dir().join("reel-thumbs").join(format!("{:016x}-card.jpg", h.finish()))
}

/// The picture at `src` as a 16:9 card `width` px wide (smaller when the picture is), as JPEG
/// bytes: from the disk if made before, else fetched, cut, shrunk and kept.
pub async fn get(src: &str, width: u32) -> Result<Vec<u8>, String> {
    let u = allowed(src, width)?;
    let file = cache_file(src, width);
    if let Ok(bytes) = tokio::fs::read(&file).await {
        return Ok(bytes);
    }
    let body = reqwest::get(u).await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let original = body.bytes().await.map_err(|e| e.to_string())?;
    let bytes = tokio::task::spawn_blocking(move || shrink(&original, width)).await.map_err(|e| e.to_string())??;
    if let Some(dir) = file.parent() {
        let _ = tokio::fs::create_dir_all(dir).await;
    }
    let _ = tokio::fs::write(&file, &bytes).await;
    Ok(bytes)
}

fn shrink(original: &[u8], width: u32) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(original).map_err(|e| format!("decoding: {e}"))?;
    // The 16:9 middle of it, then that at most `width` wide.
    let (w, h) = (img.width(), img.height());
    let (cw, ch) = if w * 9 > h * 16 { (h * 16 / 9, h) } else { (w, w * 9 / 16) };
    let img = img.crop_imm((w - cw) / 2, (h - ch) / 2, cw.max(1), ch.max(1));
    let img = if cw > width {
        img.resize_exact(width, width * 9 / 16, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82)
        .encode_image(&img.to_rgb8())
        .map_err(|e| format!("encoding: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_hosts_and_widths() {
        assert!(allowed("https://s4.anilist.co/file/a.jpg", 500).is_ok());
        assert!(allowed("https://example.com/a.jpg", 500).is_err(), "no proxy for other hosts");
        assert!(allowed("http://s4.anilist.co/file/a.jpg", 500).is_err(), "https only");
        assert!(allowed("https://s4.anilist.co/file/a.jpg", 1234).is_err());
    }

    #[test]
    fn a_picture_becomes_a_16_9_card_cut_from_its_middle() {
        let card = |w: u32, h: u32, width: u32| {
            let mut png = Vec::new();
            image::DynamicImage::new_rgb8(w, h).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
            let out = image::load_from_memory(&shrink(&png, width).unwrap()).unwrap();
            (out.width(), out.height())
        };
        assert_eq!(card(1900, 400, 500), (500, 281), "a banner: its middle, not stretched");
        assert_eq!(card(460, 650, 500), (460, 258), "a poster narrower than the card: cut, not grown");
        assert_eq!(card(1280, 720, 500), (500, 281));
    }
}
