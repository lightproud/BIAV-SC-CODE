"""测试档路径自洽守卫（结构审视 P3 副产物，2026-07-27）。

## 这条守卫是被一次假绿逼出来的

P3 把 7 个解包/wiki 脚本从 `scripts/` 移到 `projects/wiki/scripts/` 之后，全量
`pytest tests/` 报 3009 通过——看起来干净。实际上其中 **8 个档单独跑会直接
ImportError**：它们注入的仍是旧的 `scripts/`，只是因为 pytest 单进程共享
`sys.path`，先被收集的某个档已经把 `projects/wiki/scripts` 塞了进去，后面的裸名
import 就顺着别人铺的路走通了。

换句话说：**全量绿曾经是收集顺序的副产品，不是每档真的能跑。**这是扁平目录 +
手写 `sys.path` 注入这套架构的固有隐患——测试之间经全局 `sys.path` 互相污染。
清 `__pycache__` 重跑也照绿，因为病根不在缓存。

本档不试图消灭注入（那要整仓包化，成本另议），而是把「注入的路径必须真的通向
被 import 的模块」钉成静态可查的事实：档里裸名 import 了 `foo`，就必须注入某个
真的含 `foo.py` 的目录。谁再移动文件而忘了改注入，这里当场报红，不必等到某天
收集顺序变了才在 CI 里炸。

小学生比喻：全班一起进场时，走在前面的人推开了门，后面的人不用带钥匙也进得去；
等哪天他先走了，后面的人才发现自己从来没配过钥匙。本档就是挨个查钥匙。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TESTS = REPO / "tests"

#: 直跑场景下必然可用的目录：测试档自身所在目录（sys.path[0]）。
#: 刻意**不含** conftest 与 pyproject 的注入——本条守的是「档内自报能否独立
#: 支撑 `python tests/test_x.py`」，而 conftest / pyproject 只服务 pytest 那条路。
#: 让守卫吃兜底，就等于让它替自己该抓的问题打掩护。
_CONFTEST_DIRS = [TESTS]

#: `import _paths` 引导的目录（T72）——路径知识的唯一真相源，档内不再各写各的。
_PATHS_MODULE = TESTS / "_paths.py"

#: 标准库 / 第三方 / 测试自身的辅助模块，不参与「必须能在仓内找到」的判定。
_IGNORED_PREFIXES = ("pytest", "unittest", "vitest")


def _path_literals(node: ast.AST, consts: dict[str, list[str]]) -> list[str]:
    """一棵表达式子树里的路径片段，按源码顺序。

    两处坑都栽过，故都写在这里：
      1. `ast.walk` 是广度优先，直接收集会把 "projects"/"news"/"scripts"
         拼成 scripts/news/projects——所以按 (lineno, col_offset) 排序；
      2. 注入常写成变量间接（`SCRIPTS = REPO / "projects" / "wiki" / "scripts"`
         后 `sys.path.insert(0, str(SCRIPTS))`），只认字面量会把这类合法注入
         判成违规——所以先收模块级赋值，遇到 Name 就展开。
    """
    found: list[tuple[int, int, list[str]]] = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
            found.append((sub.lineno, sub.col_offset, [x for x in sub.value.split("/") if x]))
        elif isinstance(sub, ast.Name) and sub.id in consts:
            found.append((sub.lineno, sub.col_offset, consts[sub.id]))
    return [part for _, _, parts in sorted(found) for part in parts]


def _module_level_paths(tree: ast.AST) -> dict[str, list[str]]:
    """模块级 `NAME = <路径表达式>` 的片段表，供变量间接的注入展开。"""
    consts: dict[str, list[str]] = {}
    for node in getattr(tree, "body", []):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            t = node.targets[0]
            if isinstance(t, ast.Name):
                consts[t.id] = _path_literals(node.value, consts)
    return consts


def _injected_dirs(tree: ast.AST) -> list[Path]:
    """还原一个测试档在 import 之前会往 sys.path 里塞哪些目录。

    走 AST 而不是正则：注入表达式长成
    `str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts")`
    这样的嵌套调用，正则会在第一个右括号处截断，把路径片段整段漏掉。

    认不出来的写法一律放行——守卫宁可漏报，也不该因为看不懂就误伤；本档的价值
    在于抓住「移动了文件却忘改注入」这一类，而那一类都是字面量或简单变量。
    """
    consts = _module_level_paths(tree)
    dirs: list[Path] = list(_CONFTEST_DIRS)

    # `import _paths`（T72 的直跑引导）等同于引入它声明的全部源目录。
    # 认这一条，是为了让「收敛到一处」成为守卫承认的正解，而不是让 117 个档
    # 为了讨好守卫把路径又抄回去。
    for node in ast.walk(tree):
        names = (
            [a.name for a in node.names] if isinstance(node, ast.Import)
            else [node.module or ""] if isinstance(node, ast.ImportFrom)
            else []
        )
        if "_paths" in names:
            dirs.extend(_paths_source_dirs())
            break

    # 循环形态：`for _p in (str(SCRIPTS), str(NEWS_SCRIPTS)): sys.path.insert(0, _p)`
    # ——注入参数是循环变量，逐个把迭代元素当作一次注入展开。
    for node in ast.walk(tree):
        if not isinstance(node, ast.For) or not isinstance(node.target, ast.Name):
            continue
        body = ast.dump(ast.Module(body=node.body, type_ignores=[]))
        if "attr='path'" not in body or node.target.id not in body:
            continue
        for elt in getattr(node.iter, "elts", []):
            parts = _path_literals(elt, consts)
            if parts:
                dirs.append(REPO.joinpath(*parts))

    for node in ast.walk(tree):
        f = getattr(node, "func", None)
        if not (
            isinstance(node, ast.Call)
            and isinstance(f, ast.Attribute)
            and f.attr in {"insert", "append"}
            and isinstance(f.value, ast.Attribute)
            and f.value.attr == "path"
        ):
            continue
        parts: list[str] = []
        for arg in node.args:
            parts.extend(_path_literals(arg, consts))
        dirs.append(REPO.joinpath(*parts) if parts else REPO)
    return dirs


def _paths_source_dirs() -> list[Path]:
    """从 tests/_paths.py 自己的 SOURCE_DIRS 读——不在本档复述一份，
    否则真相源就又变回两处了。"""
    tree = ast.parse(_PATHS_MODULE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "SOURCE_DIRS" for t in node.targets
        ):
            return [
                REPO / e.value
                for e in node.value.elts
                if isinstance(e, ast.Constant) and isinstance(e.value, str)
            ]
    raise AssertionError("tests/_paths.py 必须声明 SOURCE_DIRS")


def _bare_imports(tree: ast.AST) -> set[str]:
    """模块顶层的裸名 import（`import foo` / `from foo import ...`），
    不含点号形式——带点的走包路径，由另一条规则覆盖。"""
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names if "." not in a.name}
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module and "." not in node.module:
                out.add(node.module)
    return out


def _repo_module_dirs() -> dict[str, set[Path]]:
    """仓内每个裸模块名实际存在于哪些目录。"""
    index: dict[str, set[Path]] = {}
    for d in [REPO / "scripts", REPO / "tests",
              REPO / "projects" / "news" / "scripts",
              REPO / "projects" / "wiki" / "scripts"]:
        for p in d.glob("*.py"):
            index.setdefault(p.stem, set()).add(d)
    return index


def test_every_bare_import_has_a_matching_injected_path() -> None:
    """裸名 import 的仓内模块，其所在目录必须被本档自己（或 conftest）注入。

    这正是 P3 移动文件后 8 个档静默失效的形态：模块搬了家，注入还指着旧地址，
    全量跑却因为别的档先铺了路而看不出来。
    """
    index = _repo_module_dirs()
    offenders: list[str] = []
    for p in sorted(TESTS.glob("test_*.py")):
        src = p.read_text(encoding="utf-8")
        try:
            tree = ast.parse(src)
        except SyntaxError:  # pragma: no cover - 语法错另有测试管
            continue
        injected = {d.resolve() for d in _injected_dirs(tree)}
        for mod in _bare_imports(tree):
            if mod.startswith(_IGNORED_PREFIXES) or mod not in index:
                continue  # 非仓内模块（标准库/第三方）不管
            homes = {d.resolve() for d in index[mod]}
            if not (homes & injected):
                offenders.append(
                    f"{p.name}: 裸名 import `{mod}`（实际在 "
                    f"{sorted(h.relative_to(REPO).as_posix() for h in homes)}），"
                    f"但本档只注入了 {sorted(d.relative_to(REPO).as_posix() for d in injected if REPO in d.parents or d == REPO)}"
                )
    assert not offenders, (
        "以下测试档的 sys.path 注入与它 import 的模块对不上——"
        "单档运行会 ImportError，全量运行只是搭了别档的便车：\n  " + "\n  ".join(offenders)
    )


def test_package_path_imports_point_at_real_files() -> None:
    """包路径形式（`from projects.wiki.scripts.x import ...`）必须指向真实文件。

    mutmut 的 twin 测试靠这种写法让运行时键与文件路径键对齐（见 setup.cfg），
    所以路径写错的代价不只是 ImportError，还会让变异测试悄悄测了个空。
    """
    offenders: list[str] = []
    for p in sorted(TESTS.glob("test_*.py")):
        src = p.read_text(encoding="utf-8")
        for m in re.finditer(r"^from ((?:scripts|projects)[\w.]*) import ", src, re.M):
            rel = m.group(1).replace(".", "/")
            # 模块（x.py）或命名空间包目录（x/）都算数得上
            if not (REPO / f"{rel}.py").exists() and not (REPO / rel).is_dir():
                offenders.append(f"{p.name}: `{m.group(1)}` → 既无 {rel}.py 也无 {rel}/ 目录")
    assert not offenders, "包路径 import 指向了不存在的文件：\n  " + "\n  ".join(offenders)


def test_mutmut_sources_exist() -> None:
    """setup.cfg 的变异区路径必须存在——移动文件时最容易被忘掉的一处。

    漏改不会让任何测试变红，只会让 mutmut 静静地少测一个模块。
    """
    cfg = (REPO / "setup.cfg").read_text(encoding="utf-8")
    block = re.search(r"^source_paths\s*=(.*?)(?=^\w|\Z)", cfg, re.M | re.S)
    assert block, "setup.cfg 缺少 [mutmut] source_paths"
    missing = [
        line.strip()
        for line in block.group(1).splitlines()
        if line.strip().endswith(".py") and not (REPO / line.strip()).exists()
    ]
    assert not missing, f"setup.cfg source_paths 指向不存在的文件：{missing}"


def test_paths_module_agrees_with_pyproject() -> None:
    """两条路径必须看到同一组目录。

    `pytest tests/` 走 pyproject 的 pythonpath，`python tests/test_x.py` 走
    tests/_paths.py。两边一旦不同步，「pytest 绿而直跑挂」的老毛病就会换个方向
    复发——那正是 T72 要收掉的病。
    """
    import tomllib

    cfg = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))
    declared = set(cfg["tool"]["pytest"]["ini_options"]["pythonpath"])
    guided = {p.relative_to(REPO).as_posix() or "." for p in _paths_source_dirs()}
    # `.` 在两边的写法不同（"." vs 空相对路径），归一后比较
    assert {d.rstrip("/") or "." for d in declared} == guided, (
        f"pyproject pythonpath {sorted(declared)} 与 tests/_paths.py SOURCE_DIRS "
        f"{sorted(guided)} 不一致"
    )


def test_no_test_file_hand_rolls_a_source_path() -> None:
    """测试档不得在模块级自行拼装源目录路径——那正是 T72 收敛掉的 117 处抄本。

    只管模块级：测试**函数体内**为验证行为而临时改 sys.path 是夹具，不是抄本
    （tests/test_news_bridge.py 就有一处，刻意放行）。
    """
    offenders: list[str] = []
    for p in sorted(TESTS.glob("test_*.py")):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in tree.body:
            # 函数/类定义整棵跳过：里面的注入是该用例的夹具，不是模块级抄本。
            # （`ast.dump` 会展开子树，不跳就会把夹具当抄本告——本条第一版的误报。）
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            dumped = ast.dump(node)
            if "attr='path'" in dumped and ("attr='insert'" in dumped or "attr='append'" in dumped):
                offenders.append(f"{p.name}:{node.lineno}")
    assert not offenders, (
        "以下测试档在模块级手写了 sys.path 注入，请改为 `import _paths`"
        f"（路径知识的唯一真相源）：{offenders}"
    )
