//! Version-control-system abstraction over Git and SVN.
//!
//! This module defines a uniform [`VcsContext`] view of whichever backend
//! (Git or SVN) governs a given working directory, so that upstream code
//! that used to shell out to `git` directly can instead ask the VCS layer
//! for the same high-level information (branch, recent commits, staged
//! files) without caring which backend is in use.
//!
//! The Git backend keeps the existing [`super::git_context::GitContext`]
//! as the source of truth so we do not disturb the 48K LOC of upstream
//! behaviour. The SVN backend is a lightweight wrapper that shells out to
//! `svn info` / `svn log` / `svn status` and presents the same shape.
//!
//! Detection order (see [`VcsContext::detect`]):
//! 1. `.git/` directory at `cwd` (or any ancestor) → Git backend
//! 2. `.svn/` directory at `cwd` → SVN backend
//! 3. Otherwise → `None`

use std::path::Path;
use std::process::Command;

use crate::git_context::{GitCommitEntry, GitContext};

/// Which backend produced a [`VcsContext`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VcsBackend {
    Git,
    Svn,
}

impl VcsBackend {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Git => "git",
            Self::Svn => "svn",
        }
    }
}

/// A single commit / revision entry, uniform across backends.
///
/// For SVN, `hash` holds the revision number (`r1234`) and `subject` holds
/// the commit message first line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VcsCommitEntry {
    pub hash: String,
    pub subject: String,
}

impl From<GitCommitEntry> for VcsCommitEntry {
    fn from(g: GitCommitEntry) -> Self {
        Self {
            hash: g.hash,
            subject: g.subject,
        }
    }
}

const MAX_RECENT_COMMITS: usize = 5;

/// Backend-agnostic view used by prompt assembly and status reporting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VcsContext {
    pub backend: VcsBackend,
    pub branch: Option<String>,
    pub recent_commits: Vec<VcsCommitEntry>,
    pub staged_files: Vec<String>,
}

impl VcsContext {
    /// Detect whichever backend governs `cwd`. Returns `None` if neither
    /// a Git nor an SVN working copy is found.
    #[must_use]
    pub fn detect(cwd: &Path) -> Option<Self> {
        if has_git(cwd) {
            return GitContext::detect(cwd).map(Self::from_git);
        }
        if has_svn(cwd) {
            return Self::detect_svn(cwd);
        }
        None
    }

    fn from_git(git: GitContext) -> Self {
        Self {
            backend: VcsBackend::Git,
            branch: git.branch,
            recent_commits: git.recent_commits.into_iter().map(Into::into).collect(),
            staged_files: git.staged_files,
        }
    }

    fn detect_svn(cwd: &Path) -> Option<Self> {
        // `svn info` confirms the working copy is valid
        let info = run_svn(cwd, &["info"])?;
        let branch = parse_svn_branch(&info);
        Some(Self {
            backend: VcsBackend::Svn,
            branch,
            recent_commits: read_svn_recent_commits(cwd),
            staged_files: read_svn_staged_files(cwd),
        })
    }

    /// Human-readable summary for system-prompt injection; shape matches
    /// [`crate::git_context::GitContext::render`] so downstream
    /// consumers cannot tell the difference.
    #[must_use]
    pub fn render(&self) -> String {
        let mut lines: Vec<String> = Vec::new();
        let vcs_label = self.backend.as_str();

        if let Some(branch) = &self.branch {
            lines.push(format!("{vcs_label} branch: {branch}"));
        }

        if !self.recent_commits.is_empty() {
            lines.push(String::new());
            lines.push("Recent commits:".to_string());
            for entry in &self.recent_commits {
                lines.push(format!("  {} {}", entry.hash, entry.subject));
            }
        }

        if !self.staged_files.is_empty() {
            lines.push(String::new());
            lines.push("Staged files:".to_string());
            for file in &self.staged_files {
                lines.push(format!("  {file}"));
            }
        }

        lines.join("\n")
    }
}

// ---------------------------------------------------------------------------
// Backend probes
// ---------------------------------------------------------------------------

fn has_git(cwd: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn has_svn(cwd: &Path) -> bool {
    // Fast path: look for a `.svn/` dir in the current directory. `svn info`
    // also works but is slower and spawns a child process.
    cwd.join(".svn").is_dir()
}

fn run_svn(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("svn")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

/// Extract a branch-like label from `svn info` output. SVN has no real
/// branches, but by convention the last segment of the URL path that
/// matches `trunk` / `branches/<name>` / `tags/<name>` is treated as one.
pub fn parse_svn_branch(info: &str) -> Option<String> {
    let url_line = info.lines().find(|l| l.starts_with("URL:"))?;
    let url = url_line.trim_start_matches("URL:").trim();
    if url.is_empty() {
        return None;
    }
    let segments: Vec<&str> = url.trim_end_matches('/').split('/').collect();
    // Walk segments in reverse looking for trunk / branches / tags markers.
    for (idx, seg) in segments.iter().enumerate().rev() {
        if *seg == "trunk" {
            return Some("trunk".to_string());
        }
        if (*seg == "branches" || *seg == "tags") && idx + 1 < segments.len() {
            let name = segments[idx + 1];
            if !name.is_empty() {
                return Some(format!("{seg}/{name}"));
            }
        }
    }
    // Fall back to the last path segment.
    segments.last().filter(|s| !s.is_empty()).map(|s| (*s).to_string())
}

fn read_svn_recent_commits(cwd: &Path) -> Vec<VcsCommitEntry> {
    let limit_arg = MAX_RECENT_COMMITS.to_string();
    let Some(out) = run_svn(cwd, &["log", "-l", &limit_arg, "--no-auth-cache"]) else {
        return Vec::new();
    };
    parse_svn_log(&out)
}

/// Parse `svn log` default output, which looks like:
///
/// ```text
/// ------------------------------------------------------------------------
/// r1234 | erica | 2026-04-14 02:30:00 +0000 | 1 line
///
/// Fix prompt injection
/// ------------------------------------------------------------------------
/// ```
pub fn parse_svn_log(text: &str) -> Vec<VcsCommitEntry> {
    let mut out: Vec<VcsCommitEntry> = Vec::new();
    let blocks = text.split("------------------------------------------------------------------------");
    for block in blocks {
        let trimmed = block.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut lines = trimmed.lines();
        let header = lines.next().unwrap_or("");
        let Some(rev_token) = header.split('|').next() else {
            continue;
        };
        let hash = rev_token.trim().to_string();
        if hash.is_empty() {
            continue;
        }
        // Skip blank line, then the subject is the next non-empty line.
        let subject = lines
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string();
        out.push(VcsCommitEntry { hash, subject });
    }
    out
}

fn read_svn_staged_files(cwd: &Path) -> Vec<String> {
    // SVN has no staging area in the Git sense; `svn status` lists local
    // modifications that would be committed. We only report items whose
    // status flag is one of A / M / D / R (added, modified, deleted,
    // replaced) — the same practical shape as Git's "staged" list.
    let Some(out) = run_svn(cwd, &["status"]) else {
        return Vec::new();
    };
    parse_svn_status(&out)
}

/// Parse `svn status` output, extracting paths whose first column marks a
/// pending commit change (`A`, `M`, `D`, `R`).
pub fn parse_svn_status(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.len() < 8 {
            continue;
        }
        let flag = line.chars().next().unwrap_or(' ');
        if matches!(flag, 'A' | 'M' | 'D' | 'R') {
            let path = line[7..].trim().to_string();
            if !path.is_empty() {
                out.push(path);
            }
        }
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
    fn parse_svn_branch_extracts_branches_name() {
        let info = "URL: https://svn.example.com/repo/branches/feature-x/src\n";
        assert_eq!(parse_svn_branch(info).as_deref(), Some("branches/feature-x"));
    }

    #[test]
    fn parse_svn_branch_extracts_trunk() {
        let info = "URL: https://svn.example.com/repo/trunk/app\n";
        assert_eq!(parse_svn_branch(info).as_deref(), Some("trunk"));
    }

    #[test]
    fn parse_svn_branch_extracts_tag_name() {
        let info = "URL: https://svn.example.com/repo/tags/v1.0/app\n";
        assert_eq!(parse_svn_branch(info).as_deref(), Some("tags/v1.0"));
    }

    #[test]
    fn parse_svn_branch_returns_none_when_no_url() {
        let info = "Path: .\nPath.1: foo\n";
        assert_eq!(parse_svn_branch(info), None);
    }

    #[test]
    fn parse_svn_log_extracts_revisions_and_subjects() {
        let sample = "\
------------------------------------------------------------------------
r1234 | erica | 2026-04-14 02:30:00 +0000 | 1 line

Fix prompt injection
------------------------------------------------------------------------
r1233 | erica | 2026-04-13 14:00:00 +0000 | 1 line

Initial commit
------------------------------------------------------------------------
";
        let entries = parse_svn_log(sample);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].hash, "r1234");
        assert_eq!(entries[0].subject, "Fix prompt injection");
        assert_eq!(entries[1].hash, "r1233");
        assert_eq!(entries[1].subject, "Initial commit");
    }

    #[test]
    fn parse_svn_status_keeps_only_pending_changes() {
        let sample = "\
A       src/new_file.rs
M       src/lib.rs
D       old.rs
?       ignored.tmp
!       missing.rs
R       replaced.rs
";
        let out = parse_svn_status(sample);
        assert_eq!(
            out,
            vec![
                "src/new_file.rs",
                "src/lib.rs",
                "old.rs",
                "replaced.rs",
            ]
        );
    }

    #[test]
    fn vcs_backend_as_str() {
        assert_eq!(VcsBackend::Git.as_str(), "git");
        assert_eq!(VcsBackend::Svn.as_str(), "svn");
    }

    #[test]
    fn render_empty_context_produces_empty_string() {
        let ctx = VcsContext {
            backend: VcsBackend::Git,
            branch: None,
            recent_commits: Vec::new(),
            staged_files: Vec::new(),
        };
        assert_eq!(ctx.render(), "");
    }

    #[test]
    fn render_includes_branch_and_commits() {
        let ctx = VcsContext {
            backend: VcsBackend::Svn,
            branch: Some("trunk".to_string()),
            recent_commits: vec![VcsCommitEntry {
                hash: "r1234".to_string(),
                subject: "Fix bug".to_string(),
            }],
            staged_files: vec!["src/lib.rs".to_string()],
        };
        let out = ctx.render();
        assert!(out.contains("svn branch: trunk"));
        assert!(out.contains("r1234 Fix bug"));
        assert!(out.contains("src/lib.rs"));
    }
}
