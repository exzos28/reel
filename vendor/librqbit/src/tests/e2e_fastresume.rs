//! reel: `AddTorrentOptions::fastresume_folder` (`fastresume.rs`) through a session: the stored
//! bitfield is used when the files hold it, and a full check runs when they do not.

use std::{path::Path, time::Duration};

use tokio::time::timeout;

use crate::{
    AddTorrent, AddTorrentOptions, CreateTorrentOptions, Session, SessionOptions, create_torrent,
    spawn_utils::BlockingSpawner,
};

/// Adds the torrent paused (so nothing but the check touches the bitfield), waits for the
/// check, and returns the bytes it has; the torrent then leaves the session.
async fn have_after_add(session: &std::sync::Arc<Session>, torrent: &[u8], files: &Path, fr: &Path) -> u64 {
    let handle = session
        .add_torrent(
            AddTorrent::from_bytes(torrent.to_vec()),
            Some(AddTorrentOptions {
                paused: true,
                overwrite: true,
                output_folder: Some(files.join("t").to_str().unwrap().to_owned()),
                fastresume_folder: Some(fr.to_owned()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    timeout(Duration::from_secs(10), handle.wait_until_initialized())
        .await
        .unwrap()
        .unwrap();
    let have = handle.stats().progress_bytes;
    session.delete(handle.id().into(), false).await.unwrap();
    have
}

async fn wait_for_bitv(file: &Path, content: &[u8]) {
    for _ in 0..500 {
        if std::fs::read(file).ok().as_deref() == Some(content) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("{file:?} is {:?}, expected {content:?}", std::fs::read(file).ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_fastresume_folder() {
    // Two files, 8 pieces of 1 KiB; piece 2 spans both (file 0 ends at 3000).
    let dir = tempfile::TempDir::with_prefix("rqbit_fastresume").unwrap();
    let files = dir.path().join("files");
    let fr = dir.path().join("fastresume");
    std::fs::create_dir_all(files.join("t")).unwrap();
    std::fs::create_dir_all(&fr).unwrap();
    let content: Vec<u8> = (0..8000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    std::fs::write(files.join("t/0.data"), &content[..3000]).unwrap();
    std::fs::write(files.join("t/1.data"), &content[3000..]).unwrap();
    let torrent = create_torrent(
        &files.join("t"),
        CreateTorrentOptions {
            piece_length: Some(1024),
            ..Default::default()
        },
        &BlockingSpawner::new(1),
    )
    .await
    .unwrap();
    let bitv = fr.join(format!("{}.bitv", torrent.info_hash().as_string()));
    let torrent = torrent.as_bytes().unwrap().to_vec();

    let session = Session::new_with_opts(
        files.clone(),
        SessionOptions {
            dht: None,
            persistence: None,
            disable_local_service_discovery: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // First add: a full check, then its result is stored.
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 8000);
    wait_for_bitv(&bitv, &[0xff]).await;

    // The stored bitfield is what the torrent starts from: piece 0 is there on disk, but the
    // bitfield says it is not, so no full check ran.
    std::fs::write(&bitv, [0x7f]).unwrap();
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 8000 - 1024);

    // File 1 truncated: refused before hashing, a full check finds pieces 0-2 (piece 3 runs
    // past the 1000 bytes left).
    std::fs::write(&bitv, [0xff]).unwrap();
    std::fs::write(files.join("t/1.data"), &content[3000..4000]).unwrap();
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 3072);
    wait_for_bitv(&bitv, &[0b1110_0000]).await;

    // File 1 rewritten with zeros at its full length: the lengths fit, the hash of its first
    // claimed piece does not, so a full check finds pieces 0-1.
    std::fs::write(&bitv, [0xff]).unwrap();
    std::fs::write(files.join("t/1.data"), vec![0u8; 5000]).unwrap();
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 2048);
    wait_for_bitv(&bitv, &[0b1100_0000]).await;

    // File 1 gone: a full check.
    std::fs::write(&bitv, [0xff]).unwrap();
    std::fs::remove_file(files.join("t/1.data")).unwrap();
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 2048);

    // A bitfield of another length (another torrent's): a full check.
    std::fs::write(files.join("t/1.data"), &content[3000..]).unwrap();
    std::fs::write(&bitv, [0x00, 0x00]).unwrap();
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 8000);
    wait_for_bitv(&bitv, &[0xff]).await;
}
