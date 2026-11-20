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

/// Replaces `file` with `content` through a new file renamed over it: a torrent that just left
/// the session may still hold the old file open (Linux keeps its writes going to that inode),
/// so writing in place could be undone by it.
fn replace(file: &Path, content: &[u8]) {
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, content).unwrap();
    std::fs::rename(&tmp, file).unwrap();
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
    // Two files of 4000 bytes, 8 pieces of 1 KiB; piece 3 spans both. The files are the same
    // size so that the layout does not depend on the order `create_torrent` reads the folder in
    // (readdir order, not sorted on Linux); `second` is whichever the torrent has second.
    let dir = tempfile::TempDir::with_prefix("rqbit_fastresume").unwrap();
    let files = dir.path().join("files");
    let fr = dir.path().join("fastresume");
    std::fs::create_dir_all(files.join("t")).unwrap();
    std::fs::create_dir_all(&fr).unwrap();
    let content = |seed: u32| -> Vec<u8> {
        (0..4000u32).map(|i| ((i + seed).wrapping_mul(2654435761) >> 13) as u8).collect()
    };
    std::fs::write(files.join("t/0.data"), content(0)).unwrap();
    std::fs::write(files.join("t/1.data"), content(7919)).unwrap();
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
    let info = torrent.as_info().info.data.clone().validate().unwrap();
    let names: Vec<_> = info.iter_file_details().map(|f| f.filename.to_pathbuf()).collect();
    assert_eq!(names.len(), 2);
    let second = files.join("t").join(&names[1]);
    let second_content = std::fs::read(&second).unwrap();
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

    // The second file truncated to 1000 bytes: refused before hashing (its first claimed
    // piece, 3, still hashes fine), a full check finds pieces 0-3 (piece 4 runs past them).
    std::fs::write(&bitv, [0xff]).unwrap();
    replace(&second, &second_content[..1000]);
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 4096);
    wait_for_bitv(&bitv, &[0b1111_0000]).await;

    // The second file rewritten with zeros at its full length: the lengths fit, the hash of its
    // first claimed piece does not, so a full check finds pieces 0-2.
    std::fs::write(&bitv, [0xff]).unwrap();
    replace(&second, &vec![0u8; 4000]);
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 3072);
    wait_for_bitv(&bitv, &[0b1110_0000]).await;

    // The second file gone: a full check.
    std::fs::write(&bitv, [0xff]).unwrap();
    std::fs::remove_file(&second).unwrap();
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 3072);

    // A bitfield of another length (another torrent's): a full check.
    replace(&second, &second_content);
    std::fs::write(&bitv, [0x00, 0x00]).unwrap();
    assert_eq!(have_after_add(&session, &torrent, &files, &fr).await, 8000);
    wait_for_bitv(&bitv, &[0xff]).await;
}
