//! reel: fastresume for one torrent, without session persistence (`REEL_PATCH.md`).
//!
//! A torrent added with `AddTorrentOptions::fastresume_folder` keeps its verified pieces in
//! `<folder>/<info_hash>.bitv` and starts from them next time instead of hashing every piece.
//! Safety:
//! - The data files are synced before the bitfield that claims their pieces is written, and the
//!   bitfield is written whole (a temporary file renamed over the old one), so a crash leaves
//!   the old bitfield or the new one, never a mix or one ahead of the data.
//! - Loading refuses a bitfield of the wrong length, or one that claims a piece of a file that
//!   is missing or shorter than that piece's end (`validate_fastresume` then hashes a sample).
//! - Nothing here fails the torrent: an error is logged and the torrent does a full check or
//!   goes on without writing the bitfield.
//! - Each bitfield object writes only while it is the current one for its file: after `clear`
//!   or a newer `load` / `store_initial_check`, its pending writes are dropped, so a bitfield
//!   that failed validation is never written back.

use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use bitvec::{boxed::BitBox, order::Msb0, slice::BitSlice};
use librqbit_core::lengths::Lengths;
use tracing::{debug, debug_span, warn};

use crate::{
    api::TorrentIdOrHash,
    bitv::BitV,
    bitv_factory::BitVFactory,
    file_info::FileInfo,
    type_aliases::BF,
};

/// The current generation of each bitfield file: only that generation's writes land.
static GENERATIONS: Mutex<Option<HashMap<PathBuf, u64>>> = Mutex::new(None);

fn next_generation(file: &Path) -> u64 {
    let mut g = GENERATIONS.lock().unwrap();
    let n = g.get_or_insert_with(HashMap::new).entry(file.to_owned()).or_insert(0);
    *n += 1;
    *n
}

/// A data file of the torrent: where it is and which bytes of the torrent it holds.
#[derive(Clone)]
struct DataFile {
    path: PathBuf,
    offset: u64,
    len: u64,
    pieces: std::ops::Range<u32>,
}

pub(crate) struct FolderBitVFactory {
    file: PathBuf,
    data: Vec<DataFile>,
    lengths: Lengths,
}

impl FolderBitVFactory {
    pub(crate) fn new(
        folder: &Path,
        info_hash: &librqbit_core::Id20,
        output_folder: &Path,
        file_infos: &[FileInfo],
        lengths: Lengths,
    ) -> Self {
        let data = file_infos
            .iter()
            .filter(|fi| !fi.attrs.padding)
            .map(|fi| DataFile {
                path: output_folder.join(&fi.relative_filename),
                offset: fi.offset_in_torrent,
                len: fi.len,
                pieces: fi.piece_range.clone(),
            })
            .collect();
        Self {
            file: folder.join(format!("{}.bitv", info_hash.as_string())),
            data,
            lengths,
        }
    }

    /// The first claimed piece whose bytes in some file are not all there (the file is missing
    /// or shorter), as a reason to log.
    fn missing_data(&self, bits: &BitSlice<u8, Msb0>) -> Option<String> {
        for f in &self.data {
            let Some(last) = f
                .pieces
                .clone()
                .rev()
                .find(|&p| bits.get(p as usize).is_some_and(|b| *b))
            else {
                continue;
            };
            let Some(piece) = self.lengths.validate_piece_index(last) else {
                return Some(format!("piece {last} out of range"));
            };
            let piece_end = self.lengths.piece_offset(piece) + self.lengths.piece_length(piece) as u64;
            let needed = piece_end.min(f.offset + f.len).saturating_sub(f.offset);
            match std::fs::metadata(&f.path) {
                Ok(m) if m.len() >= needed => {}
                Ok(m) => return Some(format!("{:?} has {} bytes, piece {last} needs {needed}", f.path, m.len())),
                Err(e) => return Some(format!("{:?}: {e}", f.path)),
            }
        }
        None
    }

    fn bitv(&self, bits: BF) -> FileBitV {
        let generation = next_generation(&self.file);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<BF>();
        let file = self.file.clone();
        let data: Vec<PathBuf> = self.data.iter().map(|d| d.path.clone()).collect();
        librqbit_core::spawn_utils::spawn(
            debug_span!("fastresume-flusher", ?file),
            format!("fastresume flusher {file:?}"),
            async move {
                while let Some(mut snapshot) = rx.recv().await {
                    while let Ok(newer) = rx.try_recv() {
                        snapshot = newer;
                    }
                    let (file, data) = (file.clone(), data.clone());
                    let r = tokio::task::spawn_blocking(move || {
                        store(&file, &data, snapshot.as_raw_slice(), generation)
                    })
                    .await;
                    match r {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => warn!("fastresume: writing the bitfield: {e:#}"),
                        Err(e) => warn!("fastresume: writing the bitfield: {e:#}"),
                    }
                }
                Ok::<_, anyhow::Error>(())
            },
        );
        FileBitV { bits, tx }
    }
}

/// Syncs the data files, then writes `bits` to `file` whole, if `generation` is still the
/// file's current one.
fn store(file: &Path, data: &[PathBuf], bits: &[u8], generation: u64) -> std::io::Result<()> {
    let current = |g: &Option<HashMap<PathBuf, u64>>| {
        g.as_ref().and_then(|m| m.get(file)).copied() == Some(generation)
    };
    if !current(&GENERATIONS.lock().unwrap()) {
        return Ok(());
    }
    for path in data {
        // Write access: Windows flushes only a handle that can write.
        match std::fs::OpenOptions::new().write(true).open(path) {
            Ok(f) => f.sync_data()?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    let tmp = file.with_extension(format!("bitv.{generation}.tmp"));
    let written = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bits)?;
        f.sync_all()
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    // Checked again with the lock held over the rename, so a `clear` cannot slip in between.
    let g = GENERATIONS.lock().unwrap();
    if !current(&g) {
        let _ = std::fs::remove_file(&tmp);
        return Ok(());
    }
    let r = std::fs::rename(&tmp, file);
    drop(g);
    if r.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    debug!(?file, "fastresume: bitfield written");
    r
}

#[async_trait::async_trait]
impl BitVFactory for FolderBitVFactory {
    async fn load(&self, _: TorrentIdOrHash) -> anyhow::Result<Option<Box<dyn BitV>>> {
        let bytes = match std::fs::read(&self.file) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => {
                warn!(file = ?self.file, "fastresume: reading the bitfield: {e:#}");
                return Ok(None);
            }
        };
        if bytes.len() != self.lengths.piece_bitfield_bytes() {
            warn!(file = ?self.file, "fastresume: the bitfield has the wrong length, checking the files");
            return Ok(None);
        }
        let bits = BF::from_boxed_slice(bytes.into_boxed_slice());
        if let Some(why) = self.missing_data(&bits) {
            warn!(file = ?self.file, "fastresume: {why}, checking the files");
            return Ok(None);
        }
        Ok(Some(Box::new(self.bitv(bits))))
    }

    async fn clear(&self, _: TorrentIdOrHash) -> anyhow::Result<()> {
        // A newer generation first: no older bitfield writes this file again.
        next_generation(&self.file);
        let _g = GENERATIONS.lock().unwrap();
        match std::fs::remove_file(&self.file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warn!(file = ?self.file, "fastresume: removing the bitfield: {e:#}"),
        }
        Ok(())
    }

    async fn store_initial_check(
        &self,
        _: TorrentIdOrHash,
        b: BF,
    ) -> anyhow::Result<Box<dyn BitV>> {
        let mut bitv = self.bitv(b);
        bitv.flush(true)?;
        Ok(Box::new(bitv))
    }
}

/// The bitfield in memory; `flush` hands a copy to the flusher. Nothing is written on drop:
/// a bitfield dropped without a flush may be one that failed validation.
pub(crate) struct FileBitV {
    bits: BitBox<u8, Msb0>,
    tx: tokio::sync::mpsc::UnboundedSender<BF>,
}

impl BitV for FileBitV {
    fn as_slice(&self) -> &BitSlice<u8, Msb0> {
        self.bits.as_bitslice()
    }

    fn as_slice_mut(&mut self) -> &mut BitSlice<u8, Msb0> {
        self.bits.as_mut_bitslice()
    }

    fn as_bytes(&self) -> &[u8] {
        self.bits.as_raw_slice()
    }

    fn flush(&mut self, _flush_async: bool) -> anyhow::Result<()> {
        if self.tx.send(self.bits.clone()).is_err() {
            warn!("fastresume: the flusher is gone");
        }
        Ok(())
    }

    fn into_dyn(self) -> Box<dyn BitV> {
        Box::new(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bits(bytes: &[u8]) -> BF {
        BF::from_boxed_slice(bytes.to_vec().into_boxed_slice())
    }

    async fn wait_for(file: &Path, content: &[u8]) {
        for _ in 0..200 {
            if std::fs::read(file).ok().as_deref() == Some(content) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("{file:?} never held {content:?}");
    }

    /// One 64 KiB file of 4 pieces of 16 KiB.
    fn factory(dir: &Path) -> FolderBitVFactory {
        let lengths = Lengths::new(65536, 16384).unwrap();
        let fi = FileInfo {
            relative_filename: "a.data".into(),
            offset_in_torrent: 0,
            piece_range: 0..4,
            attrs: Default::default(),
            len: 65536,
        };
        FolderBitVFactory::new(dir, &librqbit_core::Id20::new([7; 20]), dir, &[fi], lengths)
    }

    #[tokio::test]
    async fn test_store_load_clear() {
        let dir = tempfile::TempDir::with_prefix("fastresume").unwrap();
        let f = factory(dir.path());
        let id = TorrentIdOrHash::Id(0);
        assert!(f.load(id).await.unwrap().is_none(), "nothing stored yet");

        std::fs::write(dir.path().join("a.data"), vec![0u8; 65536]).unwrap();
        let mut b = f.store_initial_check(id, bits(&[0b1100_0000])).await.unwrap();
        wait_for(&f.file, &[0b1100_0000]).await;
        b.as_slice_mut().set(2, true);
        b.flush(true).unwrap();
        wait_for(&f.file, &[0b1110_0000]).await;

        let loaded = f.load(id).await.unwrap().expect("stored");
        assert_eq!(loaded.as_bytes(), &[0b1110_0000]);

        f.clear(id).await.unwrap();
        assert!(!f.file.exists());
        assert!(f.load(id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_refuses_a_bitfield_the_files_do_not_hold() {
        let dir = tempfile::TempDir::with_prefix("fastresume").unwrap();
        let f = factory(dir.path());
        let id = TorrentIdOrHash::Id(0);
        // Wrong length.
        std::fs::write(&f.file, [0xff, 0xff]).unwrap();
        assert!(f.load(id).await.unwrap().is_none());
        // Claims all 4 pieces: the file is missing, then holds only 3 of them.
        std::fs::write(&f.file, [0b1111_0000]).unwrap();
        assert!(f.load(id).await.unwrap().is_none());
        std::fs::write(dir.path().join("a.data"), vec![0u8; 49152]).unwrap();
        assert!(f.load(id).await.unwrap().is_none());
        // 3 pieces are there.
        std::fs::write(&f.file, [0b1110_0000]).unwrap();
        assert!(f.load(id).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn test_a_cleared_bitfield_is_never_written_back() {
        let dir = tempfile::TempDir::with_prefix("fastresume").unwrap();
        let f = factory(dir.path());
        let id = TorrentIdOrHash::Id(0);
        std::fs::write(dir.path().join("a.data"), vec![0u8; 65536]).unwrap();
        let mut stale = f.store_initial_check(id, bits(&[0b1000_0000])).await.unwrap();
        wait_for(&f.file, &[0b1000_0000]).await;
        f.clear(id).await.unwrap();
        stale.as_slice_mut().set(1, true);
        stale.flush(true).unwrap();
        drop(stale);
        // A newer bitfield's write lands; the stale one's never does.
        let _new = f.store_initial_check(id, bits(&[0b0010_0000])).await.unwrap();
        wait_for(&f.file, &[0b0010_0000]).await;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(std::fs::read(&f.file).unwrap(), [0b0010_0000]);
    }
}
