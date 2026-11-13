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
    let (session, port) = rt.block_on(async {
        let session = Session::new(dir).await.context("creating the torrent session")?;
        let listener = TcpListener::bind_tcp(SocketAddr::from(([127, 0, 0, 1], 0)), BindOpts::default())
            .context("binding the stream server")?;
        let port = listener.bind_addr().port();
        let api = Api::new(session.clone(), None, None);
        tokio::spawn(HttpApi::new(api, None).make_http_api_and_run(listener, None));
        anyhow::Ok((session, port))
    })?;
    let _ = CORE.set(Core {
        rt,
        session,
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

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};

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
