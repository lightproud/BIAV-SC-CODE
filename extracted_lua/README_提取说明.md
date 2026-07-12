# 忘却前夜 Lua 字节码提取最终成果

> **⚠ 解包 text 层已删除（守密人 2026-07-12 裁定）**：原 `Public-Info-Pool/Reference/Game-Unpacked/`
> 整层（224M / 3,694 文件）已删——wiki 冻结后消费场景消失；追溯走 git 历史，二进制本体仍在
> Releases「解包」桶（可重解 text）。下文对该层的引用按历史状态理解。

> **2026-06-21 数据本体迁移（守密人裁定「text→git / 二进制→Releases」）**：本目录下文
> 描述的交付物本体已迁走——`.luac` 字节码（hook_capture / plaintext_from_memory / raw）
> 在 GitHub Release `unpacked-assets` 的 `morimens-lua-bytecode.tar.gz`；解析后的 text
> （gamescript / config 文本 / text-data / sdk-scripts）在
> `Public-Info-Pool/Reference/Game-Unpacked/`。本目录现仅存本说明与
> `lua_scripts_inventory.csv` 清单；下文「交付目录」为迁移前的历史记录。

> 原定目标：从 `luascript_update.archive` 取出全部 639 份加密 Lua 5.4 字节码明文。
> **最终达成：981 份明文（907 hook 捕获 + 74 内存补充），去掉 35 个运行时 Config 数据块后约 946 份脚本。**

---

## ⚠️ 完整性说明

**不能保证 639 份 archive 脚本全部覆盖。** 原因：

1. **Frida hook 是中途挂载的**——游戏启动、登录、进入主界面时已经加载完毕的脚本，在 hook 安装前就已经过了 `luaL_loadbufferx`，hook 抓不到。内存扫描补回了其中 74 份，但内存扫描也只能抓到**当时还在 RAM 里**的那些。

2. **没有逛遍每个界面**——游戏的按需加载策略意味着未触发的 UI 面板（限时活动、未解锁的关卡、PVP 赛季面板等）对应的脚本不会经过 `luaL_loadbufferx`。

3. **无法做 1:1 名单校验**——archive 密文切片只有编号（`chunk_000` ~ `chunk_638`），没有文件名；而 hook 捕获有名字但无法反向匹配编号。所以无法列出"哪些 archive chunk 还没覆盖"。

**如何补全**：重新运行 hook（用现有的 `_frida_hook_loadbuf.py`），从游戏启动起就挂载，然后遍历所有游戏界面（主页各 tab、邮件、背包、战斗、剧情、觉醒、设置等）。hook 脚本自带 SHA1 去重，不会重复写入。

---

## 一、最终交付目录

```
extracted_lua/
├── README_提取说明.md           ← 本文件
├── hook_capture/                ← 981 个 .luac（核心交付）
│   ├── *.luac                   ← 907 个 Frida hook 实时捕获（干净、含原始 chunk 名）
│   └── mem_*.luac               ← 74 个内存扫描补充（尾部可能多几字节，不影响反编译）
├── plaintext_from_memory/       ← 131 个 .luac（原始内存快照，含大量冗余，仅作参照）
├── raw/                         ← 639 个密文 chunk（archive 原始切片）
└── test_xor_decrypt_chunk0.luac ← 早期 XOR 尝试残留（可忽略）
```

### hook_capture/ 文件分类

| 前缀家族 | 数量 | 说明 |
|---------|-----|------|
| `_GameScript_*` | 514 | 主游戏逻辑（战斗 / 管理器 / 扩展 / 数据 / UI / 网络等） |
| `_ejoysdk_*` | 293 | Ejoy SDK 框架（热更 / 红点 / 支付 / 登录 / 追踪等） |
| `mem_*` | 74 | 内存扫描补充的遗漏脚本（MailPanel / BagPanel / RelicConfig 等） |
| `_Config_*` | 35 | 运行时生成的配置数据块（**不在 archive 里**，是 IL2CPP 侧动态编译传入的） |
| `_Foundation_*` | 33 | 底层框架（协程 / ECS / 网络 / 系统工具） |
| `_Vue_*` | 23 | Vue 风格 UI 框架 |
| `_Share_*` | 5 | 客户端与服务端共享定义 |
| 其它 | 4 | GameMainScript / GameLauncher / xLuaInit / EnumerablePairs |

### 如何使用

1. 取一份 Lua 5.4 反编译器（unluac-rebirth / luadec 等）
2. 因为 Tuanjie 引擎把 Lua header 第 5 字节从 `0x00` 改成 `0x30`，反编译器如果校验头部需要小改（允许 0x30），或者把每个文件的第 5 字节写回 `0x00`
3. `mem_*` 前缀的文件尾部可能多几字节，但 Lua bytecode 解析器按 header 描述的结构读取，多余尾部会被忽略，不影响反编译

---

## 二、技术方法

### 2.1 核心路径：Frida hook luaL_loadbufferx
xlua.dll 未加壳，312 个导出符号完整可见。直接 `Interceptor.attach` 到 `luaL_loadbufferx` 和 `xluaL_loadbuffer`，在 onEnter 读取 `(buff, sz, name)` 三元组，dump 到文件。

### 2.2 补充路径：内存全扫描
pymem + VirtualQueryEx 遍历进程全部可读内存页（3.6GB），搜索 Tuanjie 魔数 `1B 4C 75 61 54 30`，找到 131 个命中。与 hook 去重后补充 74 个独占文件。

### 2.3 archive 密码
archive 使用分块密码（不是简单 XOR），3 组已知明文-密文推导出的 keystream 互不相同。密钥藏在 Themida 保护壳下的 `LoadLuaBytes` 调用链中。本次绕过了密码问题，直接在解密后截获明文。

---

## 三、脚本清单

| 脚本 | 作用 |
|------|------|
| `_frida_hook_loadbuf.py` | ⭐ 主 hook 脚本（产出 907 份明文） |
| `_frida_probe3.py` | xlua.dll 导出符号探测 |
| `_dump_mem_all.py` | 内存全扫描（产出 131 份） |
| `_frida_probe.py` / `_frida_probe2.py` | 早期探测脚本 |
| `_check_frida2.py` | Frida 环境检查 |
| `_scan_lua_magic.py` | 魔数定位器 |
| `_archive_scan.py` | archive 文件切片 |
| `_compare_pt_ct.py` | keystream 推导 |

---

## 四、如何继续补全

要达到真正 100% 覆盖：

1. **启动游戏前先挂 hook**：修改 `_frida_hook_loadbuf.py` 用 `frida.spawn()` 代替 `frida.attach()`，让 hook 在游戏第一条 Lua 加载前就就位
2. **遍历所有游戏内容**：登录 → 主页各 tab → 邮件 → 背包 → 商店 → 每张地图 → 战斗（各模式）→ 觉醒 → 剧情 → 设置 → 活动面板
3. hook 自带 SHA1 去重，会跳过已有文件，只增量写入新发现的脚本
4. 最终 `hook_capture/` 文件数稳定不增长时即为完全覆盖
