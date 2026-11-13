//! The built-in torrent server: a librqbit session plus its HTTP API on
//! 127.0.0.1, which streams files with Range requests
//! (`/torrents/{id}/stream/{file}`), so any player can open them by URL.

use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU32, Ordering},
    },
};

use anyhow::Context;
use librqbit::{
    AddTorrent, AddTorrentOptions, Api, Session,
    http_api::HttpApi,
};
use librqbit_dualstack_sockets::{BindOpts, TcpListener};
use serde_json::{Value, json};
use tokio::runtime::Runtime;

struct Core {
    rt: Runtime,
    session: Arc<Session>,
    api: Api,
    port: u16,
    next_job: AtomicU32,
    jobs: Arc<Mutex<HashMap<u32, Job>>>,
}

#[derive(Clone)]
enum Job {
    /// Fetching the metadata (magnet links need peers for it).
    Resolving,
    Ready(Arc<librqbit::ManagedTorrent>),
    Failed(String),
}

static CORE: OnceLock<Core> = OnceLock::new();

fn core() -> anyhow::Result<&'static Core> {
    if let Some(core) = CORE.get() {
        return Ok(core);
    }
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("reel-engine")
        .build()
        .context("starting the engine runtime")?;
    let dir = download_dir();
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let (session, port, api) = rt.block_on(async {
        let session = Session::new(dir).await.context("creating the torrent session")?;
        let listener = TcpListener::bind_tcp(SocketAddr::from(([127, 0, 0, 1], 0)), BindOpts::default())
            .context("binding the stream server")?;
        let port = listener.bind_addr().port();
        let api = Api::new(session.clone(), None, None);
        tokio::spawn(HttpApi::new(api.clone(), None).make_http_api_and_run(listener, None));
        anyhow::Ok((session, port, api))
    })?;
    let _ = CORE.set(Core {
        rt,
        session,
        api,
        port,
        next_job: AtomicU32::new(1),
        jobs: Default::default(),
    });
    Ok(CORE.get().expect("just set"))
}

/// Where downloads go for now: a cache folder. TODO: user setting + size limit.
fn download_dir() -> PathBuf {
    std::env::temp_dir().join("reel-downloads")
}

/// Starts the engine if needed; the port of its stream server.
pub fn start() -> anyhow::Result<u16> {
    Ok(core()?.port)
}

/// Adds a magnet link or torrent URL; returns a job id to poll with `status`.
pub fn add(url: &str) -> anyhow::Result<u32> {
    let core = core()?;
    let job = core.next_job.fetch_add(1, Ordering::Relaxed);
    core.jobs.lock().unwrap().insert(job, Job::Resolving);
    let (session, jobs, url) = (core.session.clone(), core.jobs.clone(), url.to_owned());
    core.rt.spawn(async move {
        let result = session
            .add_torrent(
                AddTorrent::from_url(&url),
                Some(AddTorrentOptions { overwrite: true, ..Default::default() }),
            )
            .await;
        let state = match result {
            Ok(response) => match response.into_handle() {
                Some(handle) => Job::Ready(handle),
                None => Job::Failed("the torrent was only listed".into()),
            },
            Err(e) => Job::Failed(format!("{e:#}")),
        };
        jobs.lock().unwrap().insert(job, state);
    });
    Ok(job)
}

/// The job's state as JSON:
/// `{"state":"resolving"}`, `{"state":"failed","message":…}`, or
/// `{"state":"ready","torrent":id,"name":…,"files":[{"index","name","length"}],"stats":{…}}`.
pub fn status(job: u32) -> Value {
    let Some(core) = CORE.get() else {
        return json!({ "state": "failed", "message": "the engine is not started" });
    };
    let Some(state) = core.jobs.lock().unwrap().get(&job).cloned() else {
        return json!({ "state": "failed", "message": format!("no job {job}") });
    };
    match state {
        Job::Resolving => json!({ "state": "resolving" }),
        Job::Failed(message) => json!({ "state": "failed", "message": message }),
        Job::Ready(handle) => {
            let files = handle
                .with_metadata(|m| {
                    m.file_infos
                        .iter()
                        .enumerate()
                        .map(|(index, f)| {
                            json!({
                                "index": index,
                                "name": f.relative_filename.to_string_lossy(),
                                "length": f.len,
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            json!({
                "state": "ready",
                "torrent": handle.id(),
                "name": handle.name(),
                "files": files,
                "stats": handle.stats(),
            })
        }
    }
}

/// Which parts of file `file` of the job's torrent the engine already has:
/// `{"state":"ready","length":bytes,"buckets":[0..1, …]}`, the file cut into
/// `buckets` equal byte ranges, each the fraction of its bytes downloaded
/// (whole verified pieces only). Other states as `status`.
pub fn file_map(job: u32, file: usize, buckets: usize) -> Value {
    let Some(core) = CORE.get() else {
        return json!({ "state": "failed", "message": "the engine is not started" });
    };
    let Some(state) = core.jobs.lock().unwrap().get(&job).cloned() else {
        return json!({ "state": "failed", "message": format!("no job {job}") });
    };
    let handle = match state {
        Job::Resolving => return json!({ "state": "resolving" }),
        Job::Failed(message) => return json!({ "state": "failed", "message": message }),
        Job::Ready(handle) => handle,
    };
    let layout = handle.with_metadata(|m| {
        let l = m.lengths();
        m.file_infos.get(file).map(|f| Layout {
            piece_length: l.default_piece_length() as u64,
            total_length: l.total_length(),
            file_offset: f.offset_in_torrent,
            file_length: f.len,
        })
    });
    let Ok(Some(layout)) = layout else {
        return json!({ "state": "failed", "message": format!("no file {file}") });
    };
    // Not live yet (still checking the files on disk): nothing to show.
    let Ok((have, _)) = core.api.api_dump_haves(handle.id().into()) else {
        return json!({ "state": "ready", "length": layout.file_length, "buckets": vec![0; buckets.max(1)] });
    };
    let fractions = layout.buckets(|piece| have.get(piece as usize).is_some_and(|b| *b), buckets);
    let rounded: Vec<f64> = fractions.iter().map(|f| (f * 1000.0).round() / 1000.0).collect();
    json!({ "state": "ready", "length": layout.file_length, "buckets": rounded })
}

/// Where a file lies in its torrent's pieces.
#[derive(Clone, Copy)]
struct Layout {
    piece_length: u64,
    total_length: u64,
    file_offset: u64,
    file_length: u64,
}

impl Layout {
    /// The file cut into `n` equal byte ranges (at least 1), each the fraction
    /// of its bytes that lie in pieces `have` says are downloaded.
    fn buckets(&self, have: impl Fn(u32) -> bool, n: usize) -> Vec<f64> {
        let n = n.max(1);
        if self.file_length == 0 || self.piece_length == 0 {
            return vec![0.0; n];
        }
        (0..n)
            .map(|i| {
                let start = self.file_offset + self.file_length * i as u64 / n as u64;
                let end = self.file_offset + self.file_length * (i as u64 + 1) / n as u64;
                if end <= start {
                    // More buckets than bytes: the bucket is as full as the piece its byte is in.
                    return if have((start / self.piece_length) as u32) { 1.0 } else { 0.0 };
                }
                let mut got = 0;
                let mut piece = start / self.piece_length;
                while piece * self.piece_length < end {
                    let p_start = piece * self.piece_length;
                    let p_end = (p_start + self.piece_length).min(self.total_length);
                    if have(piece as u32) {
                        got += p_end.min(end).saturating_sub(p_start.max(start));
                    }
                    piece += 1;
                }
                got as f64 / (end - start) as f64
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};

    use super::Layout;

    #[test]
    fn buckets_of_a_file_inside_the_torrent() {
        // Pieces of 100 bytes; the file is bytes 50..450 (pieces 0..=4).
        let l = Layout { piece_length: 100, total_length: 500, file_offset: 50, file_length: 400 };
        // Pieces 1 and 2 (bytes 100..300) downloaded.
        let b = l.buckets(|p| p == 1 || p == 2, 4);
        // Buckets: 50..150 (half), 150..250 (full), 250..350 (half), 350..450 (none).
        assert_eq!(b, vec![0.5, 1.0, 0.5, 0.0]);
    }

    #[test]
    fn buckets_all_and_nothing() {
        let l = Layout { piece_length: 16, total_length: 1000, file_offset: 0, file_length: 1000 };
        assert!(l.buckets(|_| true, 200).iter().all(|f| (*f - 1.0).abs() < 1e-9));
        assert!(l.buckets(|_| false, 200).iter().all(|f| *f == 0.0));
        assert_eq!(l.buckets(|_| true, 0).len(), 1);
    }

    #[test]
    fn buckets_short_last_piece_and_more_buckets_than_bytes() {
        // The last piece (bytes 200..250) is shorter than the others.
        let l = Layout { piece_length: 100, total_length: 250, file_offset: 0, file_length: 250 };
        assert_eq!(l.buckets(|p| p == 2, 5), vec![0.0, 0.0, 0.0, 0.0, 1.0]);
        let tiny = Layout { piece_length: 1, total_length: 2, file_offset: 0, file_length: 2 };
        assert_eq!(tiny.buckets(|p| p == 1, 4), vec![0.0, 0.0, 1.0, 1.0]);
    }

    /// Sintel (Blender Foundation, CC BY 3.0): the open test torrent WebTorrent uses.
    pub const SINTEL: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent";

    /// Needs the network: `cargo test -- --ignored smoke --nocapture`.
    #[test]
    #[ignore]
    fn smoke_streams_sintel() {
        let port = super::start().expect("engine starts");
        let job = super::add(SINTEL).expect("added");
        let started = Instant::now();
        let status = loop {
            let s = super::status(job);
            if s["state"] == "ready" || s["state"] == "failed" || started.elapsed() > Duration::from_secs(120) {
                break s;
            }
            std::thread::sleep(Duration::from_millis(500));
        };
        println!("metadata after {:?}: {}", started.elapsed(), status["name"]);
        assert_eq!(status["state"], "ready", "{status}");
        let files = status["files"].as_array().unwrap();
        let video = files.iter().find(|f| f["name"].as_str().unwrap().ends_with(".mp4")).expect("an mp4");
        let (torrent, index) = (&status["torrent"], &video["index"]);

        let t = Instant::now();
        let mut conn = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        conn.set_read_timeout(Some(Duration::from_secs(120))).unwrap();
        write!(conn, "GET /torrents/{torrent}/stream/{index} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=0-1048575\r\nConnection: close\r\n\r\n").unwrap();
        let mut body = Vec::new();
        conn.read_to_end(&mut body).unwrap();
        let head = String::from_utf8_lossy(&body[..body.len().min(300)]);
        println!("first MiB in {:?}; {} bytes; head:\n{}", t.elapsed(), body.len(), head.lines().take(6).collect::<Vec<_>>().join("\n"));
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        assert!(body.len() > 1_000_000);
    }
}
