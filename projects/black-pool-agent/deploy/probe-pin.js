/**
 * Black Pool desktop — sidebar pin probe (置顶功能现场探针).
 *
 * Why this exists: the pin path is localStorage-driven in the renderer
 * (`hermes.desktop.pinnedSessions` via nanostores/persistent) and mirrored to
 * the backend `sessions.pinned` flag over the Electron bridge. Both halves are
 * invisible from outside the app, so a "clicked Pin, nothing happened" report
 * can't be narrowed down from source alone. This probe makes the three
 * candidate breakpoints observable from the DevTools console:
 *
 *   1. click never reaches the store  -> no write is observed at all
 *   2. store writes, UI doesn't show  -> write observed, list still empty
 *   3. store writes, backend reverts  -> write observed, then a second write
 *                                        removes the id moments later
 *
 * Usage (守密人操作步骤):
 *   1. 在 Black Pool 桌面版按 F12（或 Ctrl+Shift+I）打开开发者工具，切到 Console
 *   2. 把本文件全文粘贴进去回车 —— 会打印当前快照并自动开始监听
 *   3. 回到界面，右键某个会话 -> 点「置顶 / Pin」
 *   4. 回到 Console 看输出，把整段截图给艾瑞卡
 *   5. 查完可执行 bpPinProbe.unwatch() 摘掉监听（或直接重启应用）
 *
 * 本探针只读不写业务数据：唯一的写入是一个自删的可写性测试键。
 */
;(() => {
  const PIN_KEY = 'hermes.desktop.pinnedSessions'
  const PROBE_KEY = 'hermes.desktop.__pinProbe'
  const tag = 'color:#7c5cff;font-weight:bold'

  const log = (...a) => console.log('%c[pin-probe]', tag, ...a)

  /** localStorage can be absent or throwing (portable/partitioned profiles). */
  const readRaw = key => {
    try {
      return { ok: true, value: window.localStorage.getItem(key) }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  const parsePins = raw => {
    if (raw == null) {
      return { state: 'absent', ids: [] }
    }

    try {
      const parsed = JSON.parse(raw)

      return Array.isArray(parsed)
        ? { state: 'ok', ids: parsed }
        : { state: 'not-an-array', ids: [], raw }
    } catch {
      return { state: 'unparseable', ids: [], raw }
    }
  }

  /** Prove the store is actually writable rather than silently swallowing. */
  const writable = () => {
    try {
      const stamp = String(Math.random())

      window.localStorage.setItem(PROBE_KEY, stamp)

      const back = window.localStorage.getItem(PROBE_KEY)

      window.localStorage.removeItem(PROBE_KEY)

      return back === stamp ? 'yes' : `NO (wrote ${stamp}, read back ${back})`
    } catch (err) {
      return `NO (${err})`
    }
  }

  const snapshot = () => {
    const raw = readRaw(PIN_KEY)

    log('--- 快照 ---')
    log('bridge (window.hermesDesktop):', window.hermesDesktop ? '在' : '缺失 —— 后端镜像整条跳过')
    log('localStorage 可写:', writable())

    if (!raw.ok) {
      log('读 pin 键失败:', raw.error)

      return { ids: [], readable: false }
    }

    const pins = parsePins(raw.value)

    log(`pin 键 ${PIN_KEY}:`, pins.state, `共 ${pins.ids.length} 条`)

    if (pins.ids.length) {
      log('已置顶 id:', pins.ids)
    }

    if (pins.state === 'not-an-array' || pins.state === 'unparseable') {
      log('原始值（异常形态，很可能就是根因）:', pins.raw)
    }

    // Any sibling key proves persistence works at all — if every one of these is
    // absent the whole persisted layer never landed, not just pins.
    const siblings = Object.keys(window.localStorage).filter(k => k.startsWith('hermes.desktop.'))

    log(`同族持久化键 ${siblings.length} 个:`, siblings)

    return { ids: pins.ids, readable: true }
  }

  let restore = null

  const watch = () => {
    if (restore) {
      log('监听已在运行')

      return
    }

    const proto = window.Storage.prototype
    const originalSet = proto.setItem
    const originalRemove = proto.removeItem
    const started = performance.now()
    const at = () => `+${Math.round(performance.now() - started)}ms`

    proto.setItem = function (key, value) {
      if (key === PIN_KEY) {
        const before = parsePins(readRaw(PIN_KEY).value).ids
        const after = parsePins(value).ids
        const added = after.filter(id => !before.includes(id))
        const dropped = before.filter(id => !after.includes(id))

        log(`${at()} 写入 pin 键 —— ${before.length} 条 -> ${after.length} 条`)

        if (added.length) {
          log('  新增:', added)
        }

        if (dropped.length) {
          log('  移除:', dropped)
        }

        if (!added.length && !dropped.length) {
          log('  内容无变化（幂等写或仅顺序调整）')
        }

        // The revert path (backend pull overwriting a fresh local pin) shows up
        // as a second write undoing the first — the stack says who did it.
        console.trace('  调用栈')
      }

      return originalSet.call(this, key, value)
    }

    proto.removeItem = function (key) {
      if (key === PIN_KEY) {
        log(`${at()} pin 键被整体删除`)
        console.trace('  调用栈')
      }

      return originalRemove.call(this, key)
    }

    restore = () => {
      proto.setItem = originalSet
      proto.removeItem = originalRemove
      restore = null
    }

    log('监听已启动 —— 现在去点「置顶」，然后回来看输出')
    log('判读: 完全没输出 = 点击没走到状态层；有输出但列表仍空 = 渲染/查找问题；先增后减 = 被后端回冲')
  }

  const unwatch = () => {
    if (restore) {
      restore()
      log('监听已摘除')
    } else {
      log('监听本就没启动')
    }
  }

  /** Read-only backend check: does the gateway carry the pinned flag at all? */
  const backend = async () => {
    if (!window.hermesDesktop) {
      log('桥缺失，后端探测跳过')

      return
    }

    try {
      const res = await window.hermesDesktop.api({ path: '/api/sessions?limit=50' })
      const rows = Array.isArray(res) ? res : (res?.sessions ?? [])
      const typed = rows.filter(r => typeof r?.pinned === 'boolean')
      const pinned = typed.filter(r => r.pinned)

      log(`后端返回 ${rows.length} 行，其中 ${typed.length} 行带 pinned 字段，${pinned.length} 行为已置顶`)

      if (!typed.length && rows.length) {
        log('后端没有 pinned 字段 —— 属旧后端，本地置顶不会被回冲，问题在前端侧')
      }

      if (pinned.length) {
        log(
          '后端认为已置顶的 id:',
          pinned.map(r => r.id)
        )
      }
    } catch (err) {
      log('后端探测失败:', String(err))
    }
  }

  window.bpPinProbe = { snapshot, watch, unwatch, backend }

  snapshot()
  watch()
  void backend()

  log('可用命令: bpPinProbe.snapshot() / .watch() / .unwatch() / .backend()')
})()
