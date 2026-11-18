//! docs/modules.md, the map of the core's API to the UI: every `#[module]` in src/ with its
//! methods, read from the Rust source (syn), and the UI files that call each method. The test
//! fails when the file is not what the source gives; `UPDATE_MODULES_MAP=1` writes it.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

const REGENERATE: &str = "UPDATE_MODULES_MAP=1 cargo test -p reel-app --test modules_map";

struct Module {
    name: String,
    doc: Vec<String>,
    native_only: bool,
    methods: Vec<Method>,
}

struct Method {
    rust: String,
    args: Vec<String>,
    ret: Option<String>,
    is_async: bool,
    doc: String,
}

impl Method {
    /// The name NSH gives the TSX side (`check_space` → `checkSpace`).
    fn ts(&self) -> String {
        let mut parts = self.rust.split('_');
        let first = parts.next().unwrap_or_default().to_owned();
        parts.fold(first, |mut name, part| {
            let mut chars = part.chars();
            if let Some(c) = chars.next() {
                name.extend(c.to_uppercase());
                name.push_str(chars.as_str());
            }
            name
        })
    }
}

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Files under `dir` with one of `extensions`, sorted, recursively.
fn files(dir: &Path, extensions: &[&str]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            found.extend(files(&path, extensions));
        } else if path.extension().is_some_and(|e| extensions.iter().any(|x| e == *x)) {
            found.push(path);
        }
    }
    found
}

fn has_attr(attrs: &[syn::Attribute], name: &str) -> bool {
    attrs.iter().any(|a| a.path().is_ident(name))
}

/// The doc comment's paragraphs, each on one line.
fn doc(attrs: &[syn::Attribute]) -> Vec<String> {
    let mut paragraphs = vec![String::new()];
    for attr in attrs.iter().filter(|a| a.path().is_ident("doc")) {
        let syn::Meta::NameValue(nv) = &attr.meta else { continue };
        let syn::Expr::Lit(syn::ExprLit { lit: syn::Lit::Str(s), .. }) = &nv.value else { continue };
        let line = s.value();
        let line = line.trim();
        let last = paragraphs.last_mut().unwrap();
        if line.is_empty() {
            paragraphs.push(String::new());
        } else {
            if !last.is_empty() {
                last.push(' ');
            }
            last.push_str(line);
        }
    }
    paragraphs.retain(|p| !p.is_empty());
    paragraphs
}

/// Whether the item is left out of the wasm32 (web) build; any other `cfg` is not expected here.
fn native_only(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().filter(|a| a.path().is_ident("cfg")).any(|a| {
        let syn::Meta::List(list) = &a.meta else { return false };
        let cfg = list.tokens.to_string();
        assert!(cfg.contains("wasm32"), "a module under cfg({cfg}): say in tests/modules_map.rs what it means");
        true
    })
}

/// A type as written: `String`, `u32`, `Vec<u32>`.
fn type_name(ty: &syn::Type) -> String {
    let syn::Type::Path(path) = ty else { panic!("a module type that is not a path: teach tests/modules_map.rs") };
    let segment = path.path.segments.last().unwrap();
    let mut name = segment.ident.to_string();
    if let syn::PathArguments::AngleBracketed(args) = &segment.arguments {
        let inner: Vec<_> = args
            .args
            .iter()
            .map(|a| match a {
                syn::GenericArgument::Type(t) => type_name(t),
                _ => panic!("a generic argument that is not a type: teach tests/modules_map.rs"),
            })
            .collect();
        let _ = write!(name, "<{}>", inner.join(", "));
    }
    name
}

fn method(f: &syn::ImplItemFn) -> Method {
    let args = f
        .sig
        .inputs
        .iter()
        .map(|input| match input {
            syn::FnArg::Typed(t) => match &*t.pat {
                syn::Pat::Ident(p) => format!("{}: {}", p.ident, type_name(&t.ty)),
                _ => panic!("a module argument that is not a name: teach tests/modules_map.rs"),
            },
            syn::FnArg::Receiver(_) => panic!("module methods take no self"),
        })
        .collect();
    let ret = match &f.sig.output {
        syn::ReturnType::Default => None,
        syn::ReturnType::Type(_, ty) => Some(type_name(ty)),
    };
    Method { rust: f.sig.ident.to_string(), args, ret, is_async: f.sig.asyncness.is_some(), doc: doc(&f.attrs).join(" ") }
}

fn self_name(item: &syn::ItemImpl) -> String {
    type_name(&item.self_ty)
}

/// The `#[module]`s of src/, sorted by name, their methods by name.
fn modules() -> Vec<Module> {
    let mut docs = Vec::new();
    let mut modules = Vec::new();
    for path in files(&app_dir().join("src"), &["rs"]) {
        let file = syn::parse_file(&std::fs::read_to_string(&path).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        for item in &file.items {
            match item {
                syn::Item::Struct(s) if has_attr(&s.attrs, "module") => docs.push((s.ident.to_string(), doc(&s.attrs))),
                syn::Item::Impl(i) if has_attr(&i.attrs, "module") => modules.push(module(i)),
                _ => {}
            }
        }
    }
    for m in &mut modules {
        m.doc = docs.iter().find(|(name, _)| *name == m.name).map(|(_, d)| d.clone()).unwrap_or_default();
    }
    modules.sort_by(|a, b| a.name.cmp(&b.name));
    modules
}

fn module(item: &syn::ItemImpl) -> Module {
    let mut methods: Vec<_> = item
        .items
        .iter()
        .filter_map(|i| match i {
            syn::ImplItem::Fn(f) if matches!(f.vis, syn::Visibility::Public(_)) => Some(method(f)),
            _ => None,
        })
        .collect();
    methods.sort_by_key(Method::ts);
    Module { name: self_name(item), doc: Vec::new(), native_only: native_only(&item.attrs), methods }
}

/// Up to the first full stop outside backticks and brackets ("e.g." in brackets stays).
fn first_sentence(text: &str) -> &str {
    let (mut depth, mut code) = (0i32, false);
    let bytes = text.as_bytes();
    for (i, c) in text.char_indices() {
        match c {
            '`' => code = !code,
            '(' | '[' | '{' if !code => depth += 1,
            ')' | ']' | '}' if !code => depth -= 1,
            '.' if !code && depth == 0 && bytes.get(i + 1).is_none_or(|b| *b == b' ') => return &text[..=i],
            _ => {}
        }
    }
    text
}

/// The JSON shapes the doc spells out: its code spans that open with `{` or `[`.
fn json_shapes(text: &str) -> Vec<&str> {
    text.split('`').skip(1).step_by(2).filter(|s| s.starts_with('{') || s.starts_with('[')).collect()
}

/// The UI's sources (paths relative to app/) and their text. `ui/native.ts` and
/// `ui/native-http.ts` wire the modules up rather than call them; tests are left out.
fn ui_sources() -> Vec<(String, String)> {
    let app = app_dir();
    let mut paths = vec![app.join("App.tsx")];
    paths.extend(files(&app.join("ui"), &["ts", "tsx"]));
    paths
        .into_iter()
        .map(|p| p.strip_prefix(&app).unwrap().to_string_lossy().replace('\\', "/"))
        .filter(|p| p != "ui/native.ts" && p != "ui/native-http.ts" && !p.contains(".test."))
        .map(|p| {
            let text = std::fs::read_to_string(app.join(&p)).unwrap();
            (p, text)
        })
        .collect()
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// Whether `line` names `needle` as a whole (`Catalog.home`, not `Catalog.homeX` or `xCatalog.home`).
fn names(line: &str, needle: &str) -> bool {
    line.match_indices(needle).any(|(i, _)| {
        let before = line[..i].chars().next_back().is_none_or(|c| !is_ident(c));
        let after = line[i + needle.len()..].chars().next().is_none_or(|c| !is_ident(c));
        before && after
    })
}

fn is_comment(line: &str) -> bool {
    let line = line.trim_start();
    line.starts_with("//") || line.starts_with('*') || line.starts_with("/*")
}

fn callers<'a>(sources: &'a [(String, String)], module: &str, method: &str) -> Vec<&'a str> {
    let needle = format!("{module}.{method}");
    sources
        .iter()
        .filter(|(_, text)| text.lines().any(|l| !is_comment(l) && names(l, &needle)))
        .map(|(path, _)| path.as_str())
        .collect()
}

fn header(out: &mut String) {
    let _ = writeln!(
        out,
        "# The core's modules\n\n\
         Generated by `app/tests/modules_map.rs` from the `#[module]`s in `app/src`: do not edit.\n\
         After changing a module, regenerate from `app/`:\n\n\
         ```sh\n{REGENERATE}\n```\n\n\
         Every NSH module the Rust core gives the UI (`app/native`, through `app/ui/native.ts`), by\n\
         name, with its methods by the names the TSX side calls (the Rust name in brackets when it\n\
         differs). Arguments and results are the Rust types; most results are JSON strings, and the\n\
         JSON shapes are the ones the doc comments spell out (the code builds them as\n\
         `serde_json::Value`s in `app/src/application`, so no Rust type names them). `async` methods\n\
         return a Promise in TS.\n\n\
         \"Called from\" lists the files (`app/App.tsx` and `app/ui`, without tests and the wiring in\n\
         `ui/native.ts` and `ui/native-http.ts`) that name `Module.method` outside a comment; a call\n\
         through another name would not show. On a TV the same modules are served over HTTP by\n\
         `platforms/tizen/core/src/table.rs`, which checks the names.\n"
    );
}

fn render_method(out: &mut String, module: &str, m: &Method, sources: &[(String, String)]) {
    let ts = m.ts();
    let prefix = if m.is_async { "async " } else { "" };
    let ret = m.ret.as_ref().map(|r| format!(" -> {r}")).unwrap_or_default();
    let rust = if ts == m.rust { String::new() } else { format!(" (`{}`)", m.rust) };
    let purpose = first_sentence(&m.doc);
    let _ = writeln!(out, "- `{prefix}{ts}({}){ret}`{rust}: {purpose}", m.args.join(", "));
    let shapes: Vec<_> = json_shapes(&m.doc).into_iter().filter(|s| !purpose.contains(*s)).collect();
    if !shapes.is_empty() {
        let shapes: Vec<_> = shapes.iter().map(|s| format!("`{s}`")).collect();
        let _ = writeln!(out, "  JSON: {}", shapes.join(" or "));
    }
    let called = callers(sources, module, &ts);
    let called = if called.is_empty() {
        "nothing in the UI".to_owned()
    } else {
        called.iter().map(|p| format!("`{p}`")).collect::<Vec<_>>().join(", ")
    };
    let _ = writeln!(out, "  Called from: {called}.");
}

fn render(modules: &[Module], sources: &[(String, String)]) -> String {
    let mut out = String::new();
    header(&mut out);
    for module in modules {
        let _ = writeln!(out, "\n## {}\n", module.name);
        for paragraph in &module.doc {
            let _ = writeln!(out, "{paragraph}\n");
        }
        if module.native_only {
            let _ = writeln!(out, "Native hosts only: not in the wasm32 web build (a TV reaches it over HTTP).\n");
        }
        for m in &module.methods {
            render_method(&mut out, &module.name, m, sources);
        }
    }
    out
}

#[test]
fn modules_map() {
    let modules = modules();
    assert!(!modules.is_empty(), "no #[module] found in src/");
    let expected = render(&modules, &ui_sources());
    let path = app_dir().join("../docs/modules.md");
    if std::env::var_os("UPDATE_MODULES_MAP").is_some() {
        std::fs::write(&path, &expected).unwrap();
        return;
    }
    let actual = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(actual == expected, "docs/modules.md is out of date with the #[module]s in app/src; regenerate from app/:\n  {REGENERATE}");
}
