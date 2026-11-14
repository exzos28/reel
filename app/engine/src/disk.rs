//! Disk space where the engine keeps its cache. `statvfs` is the same call on
//! macOS, iOS, Android and Tizen (Linux), so no per-platform code is needed.

use std::{ffi::CString, os::unix::ffi::OsStrExt, path::Path};

/// Bytes free for this app on the filesystem that holds `path` (what an
/// unprivileged process may still write: `f_bavail`, not `f_bfree`).
pub fn free_bytes(path: &Path) -> std::io::Result<u64> {
    let c = CString::new(path.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid NUL-terminated path and `st` a writable statvfs.
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    #[allow(clippy::unnecessary_cast)] // the field types differ between platforms
    Ok(st.f_bavail as u64 * st.f_frsize as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_space_of_temp_dir_is_positive() {
        assert!(free_bytes(&std::env::temp_dir()).unwrap() > 0);
    }

    #[test]
    fn missing_path_is_an_error() {
        assert!(free_bytes(Path::new("/definitely/not/here")).is_err());
    }
}
