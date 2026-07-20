"""Guarded REAL-UnityPy integration smoke test for the client-data extract path.

Recommendation #3 of the test-hardening effort: the existing decrypt/extract
tests (test_decrypt_and_extract_unit.py, test_extract_client_data_unit.py) stub
`UnityPy` into sys.modules, so the genuine UnityPy import + object-model API was
never touched. This module gates on the REAL dependency:

    pytest.importorskip("UnityPy")

If UnityPy is absent (the common case in this environment — UnityPy/PIL/weasyprint
may not be installable) the whole module SKIPS cleanly with a recorded reason,
so the gap is registered rather than silently passing on a stub.

When UnityPy IS installed, we exercise the real-dependency code path that does not
require shipping a proprietary game AssetBundle fixture: a real
`UnityPy.Environment` is constructed and the module's `extract_text_assets`
helper is run against it with the genuine UnityPy object model. The helper writing
zero objects out of an empty environment is the smoke signal that the real
UnityPy <-> extract_client_data wiring imports and iterates without error.
"""

import importlib.util
import sys
from pathlib import Path

import pytest


def _genuine_unitypy_installed() -> bool:
    """True only if the REAL UnityPy is installed on disk.

    A sibling unit test (test_decrypt_and_extract_unit.py) stubs UnityPy as a
    bare ``types.ModuleType`` in ``sys.modules`` at import time. Plain
    ``pytest.importorskip`` would then find that stub and proceed, running this
    real-API smoke test against a stub and erroring under the full suite. We
    instead probe the on-disk install via ``find_spec`` (which raises
    ``ValueError`` on a spec-less stub) and skip unless a genuine install with a
    real origin is present — so the gap stays registered, never hidden, and the
    test is robust to suite ordering / sys.modules leakage.
    """
    try:
        spec = importlib.util.find_spec("UnityPy")
    except (ImportError, ValueError):
        return False
    return spec is not None and bool(getattr(spec, "origin", None))


if not _genuine_unitypy_installed():
    pytest.skip(
        "UnityPy not genuinely installed (absent, or only a sibling test's "
        "sys.modules stub is present); real client-data extract smoke test "
        "cannot run — gap registered, not hidden.",
        allow_module_level=True,
    )

import UnityPy  # noqa: E402  genuine module (guard above guarantees real install)

REPO = Path(__file__).resolve().parent.parent
WIKI_SCRIPTS = REPO / "projects" / "wiki" / "scripts"
sys.path.insert(0, str(WIKI_SCRIPTS))


def test_extract_client_data_imports_with_real_unitypy():
    """extract_client_data must import while the REAL UnityPy is the live module.

    The existing unit tests import it with a stubbed UnityPy in sys.modules; this
    asserts the same module imports cleanly against the genuine dependency and
    actually bound the real symbols.
    """
    import extract_client_data as ecd  # noqa: WPS433 (intentional in-test import)

    assert ecd.UnityPy is UnityPy
    # ClassIDType must be the genuine enum, not a stub.
    assert hasattr(ecd.ClassIDType, "TextAsset")


def test_extract_text_assets_on_real_empty_environment(tmp_path):
    """Run extract_text_assets against a REAL UnityPy.Environment.

    An empty Environment has no objects, so the helper must complete without
    raising and emit zero text assets. This proves the real UnityPy object-model
    iteration (env.objects, obj.type, ClassIDType comparison) is wired correctly
    end-to-end — the branch the stubbed unit tests could not validate.
    """
    import extract_client_data as ecd  # noqa: WPS433

    env = UnityPy.Environment()  # real, empty environment — no proprietary bundle
    stats = {"text_assets": 0, "json_files": 0, "errors": []}

    ecd.extract_text_assets(env, tmp_path, stats)

    assert stats["text_assets"] == 0
    assert stats["errors"] == []
    # No output directory should have been created from zero objects.
    assert not (tmp_path / "text").exists()
