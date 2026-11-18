//! The core on a desktop, for running the web build in a browser against it:
//!
//!   cargo run -p reel-tizen-core --bin reel-core -- [--port N] [--token T] [--data-dir D] [--cache-dir C] [--ui-dir W] [--profile P] [--device D]
//!
//! Without `--token` a random one is made and printed. With `--ui-dir` (an NSH web build, e.g.
//! out/web) the UI is at http://127.0.0.1:N/ui/index.html?reelToken=T. Serves until Ctrl-C.

use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let base = std::env::temp_dir().join("reel-core-dev");
    let mut config = reel_tizen_core::Config {
        port: reel_tizen_core::DEFAULT_PORT,
        token: String::new(),
        data_dir: base.join("data"),
        cache_dir: base.join("cache"),
        ui_dir: None,
        profile: None,
    };
    while let Some(flag) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| usage(&format!("{flag} needs a value")));
        match flag.as_str() {
            "--port" => config.port = value().parse().unwrap_or_else(|_| usage("--port is a number")),
            "--token" => config.token = value(),
            "--data-dir" => config.data_dir = PathBuf::from(value()),
            "--cache-dir" => config.cache_dir = PathBuf::from(value()),
            "--ui-dir" => config.ui_dir = Some(PathBuf::from(value())),
            // "tizen" to filter releases as on the TV; default: this desktop's player.
            "--profile" => config.profile = Some(value()),
            // The kind of device the UI lays itself out for (mac, windows, linux, tablet, phone, tv):
            // the web build in a browser standing in for one, for screenshots (dev/screens.sh).
            "--device" => {
                let name = value();
                if reel_domain::compat::set_device(&name).is_none() {
                    usage(&format!("--device is one of {}", reel_domain::compat::DEVICES.join(", ")));
                }
            }
            _ => usage(&format!("unknown argument {flag}")),
        }
    }
    if config.token.is_empty() {
        config.token = random_token();
    }
    match reel_tizen_core::start(config.clone()) {
        Ok(running) => println!("reel core on http://127.0.0.1:{} token {}", running.port, config.token),
        Err(e) => {
            eprintln!("reel core: {e}");
            std::process::exit(1);
        }
    }
    loop {
        std::thread::park();
    }
}

fn usage(problem: &str) -> ! {
    eprintln!("{problem}\nusage: reel-core [--port N] [--token T] [--data-dir D] [--cache-dir C] [--ui-dir W] [--profile P] [--device D]");
    std::process::exit(2)
}

fn random_token() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).expect("reading /dev/urandom");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
