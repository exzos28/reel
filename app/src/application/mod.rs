//! The application layer: what the UI asks for, decided here on the domain's types and the
//! ports (`crate::wiring` hands them out). Nothing here names an adapter.

pub mod catalog;
pub mod offline;
pub mod progress;
pub mod settings;
pub mod tracks;
