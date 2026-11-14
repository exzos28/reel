// reel: how long a stream waits for its first bytes, at the start and after a
// seek, when pieces are big and every peer is slow (a 4K release from a swarm
// of home connections). Several seeders on localhost, each with an upload
// limit; a client that downloads only what its stream reads ahead, as reel
// does. The time to the first bytes is bounded by how many peers send chunks
// of the piece at the read position: from one peer it takes a piece at that
// peer's speed.

use std::{
    io::SeekFrom,
    net::{Ipv4Addr, SocketAddr},
    num::NonZeroU32,
    time::{Duration, Instant},
};

use anyhow::Context;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tracing::info;

use crate::{
    AddTorrent, CreateTorrentOptions, Session, create_torrent, limits::LimitsConfig,
    spawn_utils::BlockingSpawner,
    tests::test_util::{TestPeerMetadata, setup_test_logging},
};

use super::test_util::create_default_random_dir_with_torrents;

const MIB: usize = 1024 * 1024;
const SEEDERS: u16 = 6;
const PIECE: usize = 4 * MIB;
const FILE: usize = 48 * MIB;
/// Each seeder's upload limit.
const SEEDER_BPS: u32 = MIB as u32;

async fn stream_swarm() -> anyhow::Result<(Duration, Duration)> {
    setup_test_logging();
    let files = create_default_random_dir_with_torrents(1, FILE, Some("test_stream_swarm"));
    let torrent = create_torrent(
        files.path(),
        CreateTorrentOptions {
            name: None,
            piece_length: Some(PIECE as u32),
            ..Default::default()
        },
        &BlockingSpawner::new(1),
    )
    .await?;
    let orig = std::fs::read(files.path().join("0.data"))?;

    let mut seeders = Vec::new();
    let mut addrs: Vec<SocketAddr> = Vec::new();
    for i in 0..SEEDERS {
        let session = Session::new_with_opts(
            files.path().into(),
            crate::SessionOptions {
                dht: None,
                peer_id: Some(TestPeerMetadata::good().as_peer_id()),
                persistence: None,
                listen: Some(crate::listen::ListenerOptions {
                    listen_addr: (Ipv4Addr::LOCALHOST, 16101 + i).into(),
                    ..Default::default()
                }),
                ratelimits: LimitsConfig {
                    upload_bps: NonZeroU32::new(SEEDER_BPS),
                    download_bps: None,
                },
                ..Default::default()
            },
        )
        .await
        .context("seeder session")?;
        session
            .add_torrent(
                AddTorrent::from_bytes(torrent.as_bytes()?),
                Some(crate::AddTorrentOptions {
                    output_folder: Some(files.path().to_str().unwrap().to_owned()),
                    overwrite: true,
                    ..Default::default()
                }),
            )
            .await?
            .into_handle()
            .unwrap()
            .wait_until_completed()
            .await?;
        addrs.push(session.listen_addr().context("listen addr")?);
        seeders.push(session);
    }
    info!("{SEEDERS} seeders ready");

    let client_dir = TempDir::with_prefix("test_stream_swarm_client")?;
    let client = Session::new_with_opts(
        client_dir.path().into(),
        crate::SessionOptions {
            dht: None,
            persistence: None,
            peer_id: Some(TestPeerMetadata::good().as_peer_id()),
            ..Default::default()
        },
    )
    .await?;
    let handle = client
        .add_torrent(
            AddTorrent::from_bytes(torrent.as_bytes()?),
            Some(crate::AddTorrentOptions {
                initial_peers: Some(addrs),
                // As reel: no file is selected, only the streams' readahead is fetched.
                only_files: Some(Vec::new()),
                ..Default::default()
            }),
        )
        .await?
        .into_handle()
        .unwrap();
    handle.wait_until_initialized().await?;

    // Let the client connect to every seeder, so both reads find the same swarm.
    let started = Instant::now();
    while handle
        .live()
        .map(|l| l.per_peer_stats_snapshot(Default::default()).peers.len())
        .unwrap_or(0)
        < SEEDERS as usize
        && started.elapsed() < Duration::from_secs(5)
    {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let mut buf = vec![0u8; 16384];
    let mut stream = handle.clone().stream(0).await?;
    let t = Instant::now();
    stream.read_exact(&mut buf).await?;
    let start = t.elapsed();
    assert_eq!(buf, orig[..buf.len()]);

    // Seek well past the readahead (32 MiB by default) into a piece nobody
    // was fetching.
    let at = FILE - 2 * PIECE + 12345;
    stream.seek(SeekFrom::Start(at as u64)).await?;
    let t = Instant::now();
    stream.read_exact(&mut buf).await?;
    let seek = t.elapsed();
    assert_eq!(buf, orig[at..at + buf.len()]);

    for w in handle.take_stream_waits() {
        println!(
            "read at {:.1} MiB (piece {}{}): waited {:?}, piece came from {:?} peers in {:?}",
            w.position as f64 / MIB as f64,
            w.piece,
            if w.new_position { ", new position" } else { "" },
            w.waited,
            w.piece_peers,
            w.piece_download,
        );
    }
    println!(
        "{SEEDERS} seeders at {} KiB/s each, {} MiB pieces: first bytes at the start in {start:?}, after a seek in {seek:?}",
        SEEDER_BPS / 1024,
        PIECE / MIB
    );
    drop(stream);
    drop(seeders);
    Ok((start, seek))
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "a piece comes from one peer until the next commit"]
async fn test_stream_swarm_first_bytes() -> anyhow::Result<()> {
    let (start, seek) = tokio::time::timeout(Duration::from_secs(60), stream_swarm()).await??;
    // One seeder alone needs PIECE / SEEDER_BPS = 4 s for a piece (less the
    // limiter's first-second burst). Several peers on the piece cut that by
    // about their number.
    let one_peer = Duration::from_secs_f64(PIECE as f64 / SEEDER_BPS as f64);
    assert!(start < one_peer / 2, "start took {start:?}");
    assert!(seek < one_peer / 2, "seek took {seek:?}");
    Ok(())
}
