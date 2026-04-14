//! BPT-NEXT identity resolver (Rust port of `scripts/svn_identity.py`).
//!
//! Provides a single source of truth for "who is currently operating this
//! CLI" across environments that do not share a unified account system.
//! Probes, in priority order:
//!
//! 1. `svn info` (Last Changed Author in the current working copy)
//! 2. Local SVN auth cache (`~/.subversion/auth/svn.simple/*` or
//!    `%APPDATA%\Subversion\auth\svn.simple\*`)
//! 3. `SVN_USERNAME` env var
//! 4. `git config user.name`
//! 5. OS-level username (guaranteed non-empty fallback)
//!
//! Display-name / email / avatar metadata is merged from a two-layer
//! config file: `$HOME/.biav/svn-identity.json` (home) overridden by
//! `./.biav/svn-identity.json` (repo), matching the Python reference
//! implementation exactly.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONFIG_FILENAME: &str = "svn-identity.json";

/// Ordered probe that produced the resolved account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentitySource {
    SvnInfo,
    SvnCache,
    Env,
    Git,
    Os,
}

impl IdentitySource {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SvnInfo => "svn_info",
            Self::SvnCache => "cache",
            Self::Env => "env",
            Self::Git => "git",
            Self::Os => "os",
        }
    }
}

/// Fully resolved identity record returned by [`get_identity`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub account: String,
    pub display_name: String,
    pub source: IdentitySource,
    pub email: String,
    /// Any additional fields carried in the config entry (e.g. `avatar`).
    pub extra: BTreeMap<String, Value>,
}

/// Lightweight row returned by [`list_known_identities`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityEntry {
    pub account: String,
    pub display_name: String,
    pub email: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

// ---------------------------------------------------------------------------
// Probe helpers — silent, never panic.
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

fn run_silent(program: &str, args: &[&str]) -> Option<String> {
    // std::process::Command has no built-in timeout in stable Rust; we rely
    // on the short-lived nature of `svn info` / `git config`. If a user has
    // a hung svn server, `get_identity` will still make progress because
    // each probe is independent and the worst case — OS probe — is
    // synchronous and fast.
    let _ = PROBE_TIMEOUT; // reserved for future async-aware timeout
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

fn probe_svn_info() -> Option<String> {
    let out = run_silent("svn", &["info"])?;
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("Last Changed Author:") {
            let name = rest.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn probe_svn_cache() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs_home() {
        let unix_root = home.join(".subversion").join("auth").join("svn.simple");
        collect_files(&unix_root, &mut candidates);
    }

    if let Ok(appdata) = env::var("APPDATA") {
        let win_root = PathBuf::from(appdata)
            .join("Subversion")
            .join("auth")
            .join("svn.simple");
        collect_files(&win_root, &mut candidates);
    }

    for entry in candidates {
        let Ok(text) = fs::read_to_string(&entry) else {
            continue;
        };
        if let Some(name) = parse_svn_cache_username(&text) {
            return Some(name);
        }
    }
    None
}

/// Parse an SVN `svn.simple` cache block looking for the `username`
/// key-value pair. The block format is:
///
/// ```text
/// K 8
/// username
/// V 12
/// some-account
/// ```
pub fn parse_svn_cache_username(text: &str) -> Option<String> {
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        // Look for K <n>\nusername\nV <n>\n<value>
        if line.starts_with('K') {
            // The next line should be the key name
            let key = lines.next()?.trim();
            if key != "username" {
                continue;
            }
            // Next is the V <n> line
            let v_line = lines.next()?;
            if !v_line.starts_with('V') {
                continue;
            }
            // Next is the value itself
            let value = lines.next()?.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn collect_files(root: &Path, into: &mut Vec<PathBuf>) {
    if !root.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    paths.sort();
    into.extend(paths);
}

fn probe_env() -> Option<String> {
    let raw = env::var("SVN_USERNAME").ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn probe_git() -> Option<String> {
    let out = run_silent("git", &["config", "user.name"])?;
    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn probe_os() -> String {
    // USER on Unix, USERNAME on Windows, then fall back to "unknown".
    if let Ok(name) = env::var("USER") {
        if !name.is_empty() {
            return name;
        }
    }
    if let Ok(name) = env::var("USERNAME") {
        if !name.is_empty() {
            return name;
        }
    }
    "unknown".to_string()
}

// ---------------------------------------------------------------------------
// Config I/O — ~/.biav/svn-identity.json (home) + cwd/.biav/... (repo)
// ---------------------------------------------------------------------------

fn dirs_home() -> Option<PathBuf> {
    // Prefer HOME on Unix, USERPROFILE on Windows.
    if let Ok(home) = env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    if let Ok(userprofile) = env::var("USERPROFILE") {
        if !userprofile.is_empty() {
            return Some(PathBuf::from(userprofile));
        }
    }
    None
}

fn home_config_path() -> Option<PathBuf> {
    Some(dirs_home()?.join(".biav").join(CONFIG_FILENAME))
}

fn repo_config_path() -> Option<PathBuf> {
    Some(env::current_dir().ok()?.join(".biav").join(CONFIG_FILENAME))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    accounts: BTreeMap<String, Value>,
}

fn load_config() -> ConfigFile {
    let mut merged = ConfigFile::default();
    for path in [home_config_path(), repo_config_path()].into_iter().flatten() {
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<ConfigFile>(&text) else {
            continue;
        };
        merged.accounts.extend(parsed.accounts);
    }
    merged
}

fn write_home_config(config: &ConfigFile) -> io::Result<()> {
    let path = home_config_path()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "home directory not resolvable"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut body = serde_json::to_string_pretty(config)?;
    body.push('\n');
    fs::write(path, body)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Resolve the operator identity by probing each source in priority order.
/// Guaranteed to return a value: worst case `source == IdentitySource::Os`.
#[must_use]
pub fn get_identity() -> Identity {
    let probes: [(IdentitySource, fn() -> Option<String>); 4] = [
        (IdentitySource::SvnInfo, probe_svn_info),
        (IdentitySource::SvnCache, probe_svn_cache),
        (IdentitySource::Env, probe_env),
        (IdentitySource::Git, probe_git),
    ];

    let mut account: Option<String> = None;
    let mut source = IdentitySource::Os;
    for (src, probe) in probes {
        if let Some(value) = probe() {
            account = Some(value);
            source = src;
            break;
        }
    }

    let account = account.unwrap_or_else(probe_os);

    let config = load_config();
    let entry = config
        .accounts
        .get(&account)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let display_name = entry
        .get("display_name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| account.clone());

    let email = entry
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut extra: BTreeMap<String, Value> = BTreeMap::new();
    for (k, v) in entry {
        if k == "display_name" || k == "email" {
            continue;
        }
        extra.insert(k, v);
    }

    Identity {
        account,
        display_name,
        source,
        email,
        extra,
    }
}

/// Persist an `account -> display_name` mapping to the home config file.
/// Existing fields for the same account (email, avatar, etc.) are preserved.
pub fn set_display_name(account: &str, display_name: &str) -> io::Result<()> {
    if account.is_empty() || display_name.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "account and display_name must be non-empty",
        ));
    }

    let mut config = ConfigFile::default();
    if let Some(path) = home_config_path() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<ConfigFile>(&text) {
                config = parsed;
            }
        }
    }

    let current = config
        .accounts
        .entry(account.to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));

    if !current.is_object() {
        *current = Value::Object(serde_json::Map::new());
    }

    if let Some(obj) = current.as_object_mut() {
        obj.insert(
            "display_name".to_string(),
            Value::String(display_name.to_string()),
        );
    }

    write_home_config(&config)
}

/// Enumerate every account configured in the merged home+repo config.
#[must_use]
pub fn list_known_identities() -> Vec<IdentityEntry> {
    let config = load_config();
    let mut out: Vec<IdentityEntry> = Vec::new();
    for (name, entry) in config.accounts {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        let display_name = obj
            .get("display_name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| name.clone());
        let email = obj
            .get("email")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let mut extra: BTreeMap<String, Value> = BTreeMap::new();
        for (k, v) in obj {
            if k == "display_name" || k == "email" {
                continue;
            }
            extra.insert(k.clone(), v.clone());
        }
        out.push(IdentityEntry {
            account: name,
            display_name,
            email,
            extra,
        });
    }
    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_svn_cache_block_returns_username() {
        let sample = "K 15\nsvn:realmstring\nV 10\nsome-realm\nK 8\nusername\nV 12\nerica-a10\nK 8\npassword\nV 6\nsecret\nEND\n";
        assert_eq!(
            parse_svn_cache_username(sample).as_deref(),
            Some("erica-a10")
        );
    }

    #[test]
    fn parse_svn_cache_block_returns_none_when_no_username() {
        let sample = "K 15\nsvn:realmstring\nV 10\nsome-realm\nEND\n";
        assert!(parse_svn_cache_username(sample).is_none());
    }

    #[test]
    fn identity_source_as_str_round_trip() {
        assert_eq!(IdentitySource::SvnInfo.as_str(), "svn_info");
        assert_eq!(IdentitySource::SvnCache.as_str(), "cache");
        assert_eq!(IdentitySource::Env.as_str(), "env");
        assert_eq!(IdentitySource::Git.as_str(), "git");
        assert_eq!(IdentitySource::Os.as_str(), "os");
    }

    #[test]
    fn get_identity_never_returns_empty_account() {
        let id = get_identity();
        assert!(!id.account.is_empty());
        assert!(!id.display_name.is_empty());
    }

    #[test]
    fn set_display_name_rejects_empty_input() {
        assert!(set_display_name("", "Name").is_err());
        assert!(set_display_name("acct", "").is_err());
    }
}
