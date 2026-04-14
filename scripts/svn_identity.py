#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""银芯身份识别模块 —— 面向黑池需求 1（用户档案）的 SVN 账号读取器。

无账号下的身份凭据单一来源。艾瑞卡自动人偶在此执行多路径探测：
SVN 工作副本 → 本地凭据缓存 → 环境变量 → git 配置 → 系统用户名。
所有探测均静默容错；最差情况仍回落至 os 层，保证上游调用方永远获得合法 identity。

外显名映射（display_name）存放于 `~/.biav/svn-identity.json`，
schema: {"accounts": {"<svn_account>": {"display_name": "...", "email": "...", "avatar": "..."}}}
"""

from __future__ import annotations

import getpass
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONFIG_FILENAME = "svn-identity.json"
HOME_CONFIG_DIR = Path.home() / ".biav"
HOME_CONFIG_PATH = HOME_CONFIG_DIR / CONFIG_FILENAME
REPO_CONFIG_PATH = Path.cwd() / ".biav" / CONFIG_FILENAME

SOURCE_SVN_INFO = "svn_info"
SOURCE_SVN_CACHE = "cache"
SOURCE_ENV = "env"
SOURCE_GIT = "git"
SOURCE_OS = "os"

# ---------------------------------------------------------------------------
# Probe helpers (silent, never raise)
# ---------------------------------------------------------------------------


def _run(cmd: list[str], timeout: int = 5) -> Optional[str]:
    """Run subprocess silently; return stdout on success, None otherwise."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    except Exception:
        return None
    return None


def _probe_svn_info() -> Optional[str]:
    """Priority 1: svn info in cwd; parse 'Last Changed Author'."""
    out = _run(["svn", "info"])
    if not out:
        return None
    match = re.search(r"^Last Changed Author:\s*(.+)$", out, re.MULTILINE)
    if match:
        name = match.group(1).strip()
        return name or None
    return None


def _probe_svn_cache() -> Optional[str]:
    """Priority 2/3: parse username from local SVN auth cache.

    Linux/macOS: ~/.subversion/auth/svn.simple/*
    Windows:     %APPDATA%\\Subversion\\auth\\svn.simple\\*
    """
    candidates: list[Path] = []

    unix_root = Path.home() / ".subversion" / "auth" / "svn.simple"
    if unix_root.is_dir():
        candidates.extend(sorted(unix_root.iterdir()))

    appdata = os.environ.get("APPDATA")
    if appdata:
        win_root = Path(appdata) / "Subversion" / "auth" / "svn.simple"
        if win_root.is_dir():
            candidates.extend(sorted(win_root.iterdir()))

    for entry in candidates:
        if not entry.is_file():
            continue
        try:
            text = entry.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        # SVN cache entries use "K <len>\nusername\nV <len>\n<value>\n" blocks
        m = re.search(
            r"K\s+\d+\s*\nusername\s*\nV\s+\d+\s*\n([^\n]+)",
            text,
        )
        if m:
            name = m.group(1).strip()
            if name:
                return name
    return None


def _probe_env() -> Optional[str]:
    """Priority 4: SVN_USERNAME env var."""
    name = os.environ.get("SVN_USERNAME", "").strip()
    return name or None


def _probe_git() -> Optional[str]:
    """Priority 5: git config user.name (fallback)."""
    out = _run(["git", "config", "user.name"])
    if out:
        name = out.strip()
        return name or None
    return None


def _probe_os() -> str:
    """Priority 6: system username; guaranteed non-empty."""
    try:
        name = os.getlogin()
        if name:
            return name
    except OSError:
        pass
    try:
        name = getpass.getuser()
        if name:
            return name
    except Exception:
        pass
    # Absolute last resort
    return os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"


# ---------------------------------------------------------------------------
# Config (display name mapping) I/O
# ---------------------------------------------------------------------------


def _load_config() -> dict:
    """Load first existing config file; merge repo-level over home-level.

    Repo-level config (cwd/.biav/svn-identity.json) overrides home-level.
    """
    merged: dict = {"accounts": {}}
    for path in (HOME_CONFIG_PATH, REPO_CONFIG_PATH):
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        accounts = data.get("accounts")
        if isinstance(accounts, dict):
            merged["accounts"].update(accounts)
    return merged


def _write_home_config(config: dict) -> None:
    """Write config to ~/.biav/svn-identity.json; create dir on demand."""
    HOME_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    HOME_CONFIG_PATH.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_identity() -> dict:
    """Resolve current identity via multi-path probing.

    Returns a dict with keys: account, display_name, source, email, extra.
    Never raises; worst case source='os'.
    """
    probes = (
        (SOURCE_SVN_INFO, _probe_svn_info),
        (SOURCE_SVN_CACHE, _probe_svn_cache),
        (SOURCE_ENV, _probe_env),
        (SOURCE_GIT, _probe_git),
    )

    account: Optional[str] = None
    source = SOURCE_OS
    for src, probe in probes:
        try:
            value = probe()
        except Exception:
            value = None
        if value:
            account = value
            source = src
            break

    if not account:
        account = _probe_os()
        source = SOURCE_OS

    config = _load_config()
    entry = config.get("accounts", {}).get(account, {})
    display_name = entry.get("display_name") or account
    email = entry.get("email", "")
    extra = {k: v for k, v in entry.items() if k not in {"display_name", "email"}}

    return {
        "account": account,
        "display_name": display_name,
        "source": source,
        "email": email,
        "extra": extra,
    }


def set_display_name(account: str, display_name: str) -> None:
    """Persist account -> display_name mapping to ~/.biav/svn-identity.json.

    Creates the ~/.biav directory only when called (never on import).
    Preserves existing email / avatar / other fields for the account.
    """
    if not account or not display_name:
        raise ValueError("account and display_name must be non-empty")

    config: dict = {"accounts": {}}
    if HOME_CONFIG_PATH.is_file():
        try:
            loaded = json.loads(HOME_CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("accounts"), dict):
                config = loaded
        except (OSError, json.JSONDecodeError):
            pass

    accounts = config.setdefault("accounts", {})
    current = accounts.get(account, {})
    if not isinstance(current, dict):
        current = {}
    current["display_name"] = display_name
    accounts[account] = current

    _write_home_config(config)


def list_known_identities() -> list[dict]:
    """List all configured identities from merged home+repo config."""
    config = _load_config()
    accounts = config.get("accounts", {})
    result: list[dict] = []
    for name, entry in accounts.items():
        if not isinstance(entry, dict):
            continue
        item = {
            "account": name,
            "display_name": entry.get("display_name") or name,
            "email": entry.get("email", ""),
        }
        for k, v in entry.items():
            if k not in {"display_name", "email"}:
                item[k] = v
        result.append(item)
    return result


# ---------------------------------------------------------------------------
# CLI entry
# ---------------------------------------------------------------------------


def _cli_whoami() -> int:
    identity = get_identity()
    print(json.dumps(identity, indent=2, ensure_ascii=False))
    return 0


def _cli_set(argv: list[str]) -> int:
    if len(argv) < 2:
        print("用法: svn_identity.py set <account> <display_name>", file=sys.stderr)
        return 2
    account, display_name = argv[0], argv[1]
    try:
        set_display_name(account, display_name)
    except ValueError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"错误: 写入配置失败 —— {exc}", file=sys.stderr)
        return 1
    print(f"已写入映射: {account} -> {display_name}")
    print(f"配置档案: {HOME_CONFIG_PATH}")
    return 0


def _cli_list() -> int:
    identities = list_known_identities()
    if not identities:
        print("尚未配置任何身份映射。")
        return 0
    print(json.dumps(identities, indent=2, ensure_ascii=False))
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print("用法: svn_identity.py {whoami|set|list} [args...]", file=sys.stderr)
        return 2
    cmd, rest = argv[0], argv[1:]
    if cmd == "whoami":
        return _cli_whoami()
    if cmd == "set":
        return _cli_set(rest)
    if cmd == "list":
        return _cli_list()
    print(f"未知指令: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
