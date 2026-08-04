# public-workshop/ — 公版仓内车间（银芯 checkout 自持组装能力）

> 守密人 2026-08-04 指示「让银芯仓库本身也拥有组装能力，用于公版」的落地：任何克隆了
> 银芯仓的 Windows 机器，凭本目录即可把 Release 上的**公版** Black Pool 包组装落位、
> 就地可用——与内网 `bpa-dev` 车间（`../deploy/` 拷走型三脚本）同构，但**自根于仓内**、
> **零内网件**（公版 = 纯品牌换装，无 intranet 补丁 / 无配置注入，§1.1-HC 无涉）。

## 目录约定（运行时目录均不入 git，见本目录 .gitignore）

```
public-workshop/
├── RUNBOOK.md        # 本档
├── assemble.cmd      # 组装 + 部署一步走（验货 → 解压 → 启动器套新 → home 保全 → 轮换落位）
├── rollback.cmd      # 一键回切上一版
├── releases/         # 进料位：把下载的 black-pool-public-win64.zip 放这里（可选 CHECKSUMS.txt 验货）
├── staging/          # 组装台（脚本自管，勿手动动）
├── BlackPool/        # 落位成品：双击其中 launcher.cmd 即用
└── BlackPool.old/    # 回滚位（自动滚动，只留最近一版）
```

## 使用步骤

1. **进料**：从银芯 Release 下载公版包放入 `releases/`：
   - 直连：`https://github.com/lightproud/BIAV-SC-CODE/releases/download/black-pool-bundle/black-pool-public-win64.zip`
   - 直连不稳时加镜像前缀（任选其一，前缀站存活率无常）：
     `https://gh-proxy.com/<上面的直连地址>` 或 `https://ghfast.top/<直连地址>`
   - 包不存在或要新鲜包时，先在 GitHub Actions 手动跑 `assemble-black-pool-public.yml` 出包。
2. **组装**：双击 `assemble.cmd`（或命令行传 zip 文件名指定进料）。脚本依次：
   SHA 验货（`releases/CHECKSUMS.txt` 存在时）→ 解压进 `staging/` → 启动器族按仓内
   `../deploy/` 套件版覆盖（launcher / 监督器 / venv 自愈，保持与仓同新）→ 旧
   `BlackPool/home` 用户数据增量保全 → 旧版轮换进 `BlackPool.old/` → 成品落位 `BlackPool/`。
3. **启动**：双击 `BlackPool/launcher.cmd`（或落位时生成的 `Black Pool.lnk`）。
4. **升级**：新 zip 入 `releases/` 重跑 `assemble.cmd`——home 自动保全，旧版自动进回滚位。
5. **回滚**：双击 `rollback.cmd`，一键回切上一版（问题版让位到 `BlackPool.failed-*` 供取证）。

## 边界与纪律

- **只吃公版包**：本车间不含任何内网注入工序；私有版组装走内网 `bpa-dev` 车间
  （部署件收纳与用法见 `../build/README.md`）。
- **产物不入 git**：`releases/` / `staging/` / `BlackPool*` / 日志全部被 `.gitignore`
  排除，车间怎么用都不会弄脏仓库。
- **cmd 工程纪律沿用 `../deploy/` 车间实弹经验**：goto 守卫防括号路径、goto 标签后
  ASCII-only 防 65001 解析错位、CRLF 由仓根 `.gitattributes` 钉死。
- 守卫测试：`pytest tests/test_public_workshop.py -v`。
