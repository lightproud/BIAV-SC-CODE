"""UnityPy 桩单一真相源（测试夹具，非被测代码）。

`projects/wiki/scripts/` 下的解包脚本在**模块顶层** import UnityPy，import 不到就
`sys.exit(1)`；而 UnityPy 在本环境常常装不上（见 `test_integration_unitpy_optional.py`）。
故这些脚本的单测必须在 import 目标模块**之前**先往 `sys.modules` 里塞一个桩。

这段塞桩逻辑原先在 5 个测试档里各抄一份（`test_decrypt_and_extract{,_more,_unit}.py`
三份逐字节相同，`test_extract_client_data{,_unit}.py` 两份是其子集）。抄写的代价不只是
行数：子集版**不带** `helpers.ArchiveStorageManager`，谁先跑谁定桩，于是全套件跑起来时
装桩结果取决于收集顺序——超集版只好加一句 `hasattr(..., "helpers")` 兜底升级。收敛到
本模块后装的永远是**完整桩**，顺序敏感性随抄写一起消失（子集消费方只用到子集，安全）。

用法（必须在 import 目标脚本之前调用）::

    from unitypy_stub import install_unitypy_stub
    install_unitypy_stub()
    import decrypt_and_extract as dae  # noqa: E402
"""
from __future__ import annotations

import sys
import types
from unittest import mock


class _ClassIDType:
    """UnityPy.enums.ClassIDType 的最小替身：只要能相等比较 + 可哈希。"""

    class _T:
        def __init__(self, name):
            self.name = name

        def __eq__(self, other):
            return isinstance(other, _ClassIDType._T) and other.name == self.name

        def __hash__(self):
            return hash(self.name)

    TextAsset = _T("TextAsset")
    MonoBehaviour = _T("MonoBehaviour")
    Texture2D = _T("Texture2D")


def install_unitypy_stub() -> None:
    """把完整 UnityPy 桩装进 ``sys.modules``；已装过则原样返回（幂等）。"""
    if "UnityPy" in sys.modules and hasattr(sys.modules["UnityPy"], "helpers"):
        return

    unitypy = sys.modules.get("UnityPy") or types.ModuleType("UnityPy")
    unitypy.load = mock.MagicMock(name="UnityPy.load")
    unitypy.set_assetbundle_decrypt_key = mock.MagicMock()
    enums = types.ModuleType("UnityPy.enums")
    enums.ClassIDType = _ClassIDType
    unitypy.enums = enums
    helpers = types.ModuleType("UnityPy.helpers")
    archive = types.ModuleType("UnityPy.helpers.ArchiveStorageManager")
    archive.brute_force_key = mock.MagicMock(name="brute_force_key")
    helpers.ArchiveStorageManager = archive
    unitypy.helpers = helpers
    sys.modules["UnityPy"] = unitypy
    sys.modules["UnityPy.enums"] = enums
    sys.modules["UnityPy.helpers"] = helpers
    sys.modules["UnityPy.helpers.ArchiveStorageManager"] = archive
