# BIAV-SC 分仓 §7乙 · 历史重写真缩 clone —— 守密人本地执行手册

> **性质**：全计划**唯一不可逆**步。重写 BIAV-SC-CODE 全部 git 历史、purge 掉
> `Public-Info-Pool/Record/Community`（658M / 21829 文件的历史 blob），使 `.git`
> 从 ~445M 缩到小几十 M。**所有现存 clone / open PR / 每个 commit SHA 全部失效**，人人须重新 clone。
>
> **为何须守密人本地操刀（不由云会话代跑）**：(1) 云会话是**浅 clone**（`.git/shallow`、147 commit），
> 重写全史需完整历史，浅 clone 做不了；(2) 重写须 **force-push 覆盖受保护 main**，云 PR 流推不动；
> (3) 属仓库管理员级破坏性外向操作，超出 feature 分支 + PR 授权模型。
>
> **裁定链**：守密人 2026-07-20「§7乙」裁进 + 同日选「方案 2：补齐前置后本地执行」。§7甲（取消跟踪）已完成（PR #794）。

---

## 0. 先决判断（做不做）

§7甲 已拿到实用大头：**fresh checkout 不再含 658M**（工作树已轻）。§7乙 只再省 **clone 下载体积**
（`.git` 445M→小），代价是不可逆 + 破坏所有引用 + 需管理员本地操作 + 所有人重新 clone。
**若 clone 下载体积可忍，可长期停在 §7甲**。下述步骤仅在守密人确要缩 `.git` 时执行。

---

## 1. 前置校验（三项全绿方可动手，缺一即停）

### P1 · BIAV-SC-DATA 全量完整（数据的权威现居地，重写后 code 仓永不再有）
```bash
# 在有 data 仓访问权的机器上
git clone https://github.com/lightproud/BIAV-SC-DATA.git /tmp/data-verify
du -sh /tmp/data-verify/Record/Community            # 期望 ≈ 658M（与 code 仓在树时相当）
find /tmp/data-verify/Record/Community -type f | wc -l   # 期望 ≈ 21829（±采集增量）
ls /tmp/data-verify/Record/Community/discord         # discord 各区服在
ls /tmp/data-verify/Record/Community                 # 16+ 平台目录在
```
**判据**：体量 / 文件数与 code 仓在树历史相当（允许因采集只增不减略多）。**明显偏小 = 停，先补齐 data 仓**。

### P2 · 全量 mirror 备份（重写的逃生绳，务必先做）
```bash
# 完整裸镜像（含全部历史 + 全部 ref），存异地/冷存储，重写后至少留存 30 天
git clone --mirror https://github.com/lightproud/BIAV-SC-CODE.git /safe/offsite/biav-sc-code-PREREWRITE.git
du -sh /safe/offsite/biav-sc-code-PREREWRITE.git     # 期望 ≈ 445M（含待 purge 的历史 blob）
# 校验完整性
git -C /safe/offsite/biav-sc-code-PREREWRITE.git fsck --full
```
**判据**：镜像 clone 成功 + fsck 无 error。**这份镜像是唯一回滚源，重写确认无误前绝不删。**

### P3 · community-data 文本 Release 备份（可选，belt-and-suspenders）
`RELEASES.md` 记 `community-data` 桶已退役删除（当初理由「已永驻 git」）。重写后 code 仓历史亦无此文本，
届时文本副本 = BIAV-SC-DATA（P1）+ mirror（P2）。若要第三份冷备：
```bash
tar czf community-text-backup-20260720.tar.gz -C /tmp/data-verify Record/Community
gh release create community-data-backup-20260720 community-text-backup-20260720.tar.gz \
  --repo lightproud/BIAV-SC-CODE --title "Community text cold backup (pre §7乙)" \
  --notes "Record/Community 全量文本冷备，§7乙 历史重写前留存"
```
**判据**：P1+P2 已足够（两份独立副本）；P3 为额外保险，按需。

---

## 2. 历史重写（在 P2 的镜像的**工作副本**上做，不动原镜像备份）

```bash
# 用另一份新 mirror 做工作副本（原 PREREWRITE 镜像保持不动作备份）
git clone --mirror https://github.com/lightproud/BIAV-SC-CODE.git /work/biav-rewrite.git
cd /work/biav-rewrite.git

# 装 git-filter-repo（官方推荐工具，非 filter-branch）
pip install git-filter-repo    # 或 brew install git-filter-repo

# 记录重写前指标
du -sh .                                    # ~445M
git log --all --oneline -- Public-Info-Pool/Record/Community | wc -l   # 涉及该路径的提交数（应 >0）

# 从全部历史 purge 数据湖路径（--invert-paths = 移除匹配路径）
git filter-repo --path Public-Info-Pool/Record/Community --invert-paths --force

# filter-repo 出于安全会移除 origin remote —— 重加
git remote add origin https://github.com/lightproud/BIAV-SC-CODE.git
```

---

## 3. 重写后验证（force-push 前必须全绿）

```bash
cd /work/biav-rewrite.git
git gc --prune=now --aggressive          # 真正回收被 purge 的 blob
du -sh .                                  # 期望大幅缩小（445M → 小几十 M）
git fsck --full                           # 无 error

# 路径已从全史消失
git log --all --oneline -- Public-Info-Pool/Record/Community | wc -l   # 期望 0

# 除 Record/Community 外无误伤：比对最新树
git ls-tree -r --name-only HEAD | grep -c '^Public-Info-Pool/Record/Community/'   # 期望 0
git ls-tree -r --name-only HEAD | grep -c '^Public-Info-Pool/Record/store-patrol/' # 期望 >0（保留项未误伤）
git cat-file -p HEAD:CLAUDE.md | head -1  # 代码/文档本体仍在
```
**判据**：`.git` 明显缩小 + fsck 无 error + 该路径全史为 0 + store-patrol/代码本体完好。**任一不符 = 停，弃工作副本重来。**

---

## 4. force-push（临时解 main 保护，推完复原）

```bash
# 4.1 GitHub 网页：Settings → Rulesets → main 规则集 → 临时 Disable（或加自己进 bypass list）
#     （required checks + 禁 force-push 会挡，必须临时放开）

# 4.2 强推重写后的全部分支 + tag（覆盖远端历史）
cd /work/biav-rewrite.git
git push --force origin --all
git push --force origin --tags

# 4.3 GitHub 网页：立即重新 Enable main 规则集（恢复保护，勿久留敞口）
```
> **注意**：`--all` 会强推所有本地分支。若远端有你不想动的分支，改逐分支：`git push --force origin main`。
> open PR 的 head 分支重写后引用失效，PR 需关掉重开或 rebase。

---

## 5. 善后

1. **通知所有协作者 / 会话重新 clone**：旧 clone 历史已分叉，`git pull` 会冲突——一律删旧目录重新 `git clone`。
2. **本云会话**：其 feature 分支 `claude/todo-implementation-uxhk0z` 及后续会话须在重写后的 main 上重新起分支。
3. **open PR 巡检**：重写前未合的 PR 需重建（head 分支 SHA 已变）。
4. **确认无误后**（建议观察 ≥30 天）方可删 P2 的 PREREWRITE 镜像备份；在此之前它是唯一回滚源。

---

## 6. 回滚（force-push 后发现问题，用 P2 镜像还原）

```bash
# 从 PREREWRITE 镜像强推回原历史（临时解 main 保护同 §4）
cd /safe/offsite/biav-sc-code-PREREWRITE.git
git remote add origin https://github.com/lightproud/BIAV-SC-CODE.git 2>/dev/null || true
git push --force origin --all
git push --force origin --tags
# 复原 main 保护
```
**前提**：P2 镜像未删。这就是「重写确认无误前绝不删 PREREWRITE 镜像」的原因。

---

## 附:一句话小学生比喻

给整栋楼翻修地基、把废料（658M 旧聊天记录）从每一层的墙里都抠出来——干这活得有整栋楼的完整图纸（完整历史，浅 clone 没有）、得先把原样翻拍存档（mirror 备份，翻砸了照图重建）、还得暂时拆掉大门的门禁（解 main 保护）才能把新楼推上去；干完通知所有住户按新钥匙重新进门（重新 clone）。云会话手里只有顶楼几层图纸、大门门禁也拆不动，所以这活得守密人在有完整图纸的本机干。
