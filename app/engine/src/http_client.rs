//! HTTP clients for this crate. On Android every client checks servers against Mozilla's
//! root certificates built in (webpki-root-certs): reqwest's default verifier asks the
//! platform there, which needs the app's Java side initialised, and NSH's app does not do
//! that, so every HTTPS request failed. Elsewhere the platform verifier stays.

/// A client builder with this platform's way of checking certificates.
pub fn client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    #[cfg(target_os = "android")]
    let builder = builder.tls_certs_only(
        webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().filter_map(|c| reqwest::Certificate::from_der(c).ok()),
    );
    builder
}
