# BIAV 自部署 RSSHub

扩展采集管线（`collect_global.py`）依赖 RSSHub 代理抓取一批反爬严重的平台：
weibo / zhihu / xiaohongshu / douyin / pixiv / lofter / nga / bilibili / tieba /
5ch / dcinside / reddit / telegram / tiktok。

当前指向的 `https://biav-rsshub.vercel.app` 在 16 条路由里只有 1 条能用
（`/telegram/channel/Morimens`）。跑 `python projects/news/scripts/test_rsshub.py`
会告诉你每条挂的原因，典型结果：

```
/weibo/keyword/*     503  Could not find Chrome (ver. 136.0.7103.49)
/pixiv/search/*      503  pixiv RSS is disabled due to the lack of PIXIV_REFRESHTOKEN
/lofter/tag/*        503  require() of ES Module @exodus/bytes
/bilibili/search/*   503  {"error":{"message":""}}     ← 静默失败，也是 Chrome 找不到
...
/telegram/channel/*  200  5 items                      ← 唯一活着的路由
```

**根因**：Vercel 的 serverless function 执行环境不能跑 Puppeteer（没有 Chrome
二进制，而且 60s 执行上限对 JS 渲染的路由太短）。RSSHub 里大部分中文/日文路由
都需要无头浏览器渲染，所以全挂。

## 解决方案：换一个能跑 Puppeteer 的宿主

以下任选其一。推荐 **Fly.io**，因为它有真实的 free tier + 东京区 + 自动 HTTPS。

---

### 方案 A：Fly.io（推荐）

前置：安装 flyctl、注册 fly.io 账号、绑定信用卡（free tier 不会扣）。

```bash
cd projects/news/rsshub-deploy

# 1. 登录并创建 app
flyctl auth login
flyctl apps create biav-rsshub    # 如果想换名字，同步改 fly.toml 的 app 字段

# 2. 先部署（此时 cookie 路由仍会空，但公共路由应该都能活）
flyctl deploy -c fly.toml

# 3. 验证：应该有 10+ 个路由 OK
python ../scripts/test_rsshub.py https://biav-rsshub.fly.dev

# 4. 为 weibo/zhihu/xhs/pixiv 等需要凭据的路由配 secrets
#    每个 cookie 的获取方法见 .env.example
flyctl secrets set -c fly.toml \
  WEIBO_COOKIE="SUB=xxx; SUBP=xxx" \
  ZHIHU_COOKIES="z_c0=xxx" \
  XIAOHONGSHU_COOKIE="a1=xxx; web_session=xxx" \
  PIXIV_REFRESHTOKEN="xxx"

# 5. 再次验证：现在应该 14+/16 都活
python ../scripts/test_rsshub.py https://biav-rsshub.fly.dev
```

最后把新 URL 写进 GitHub Secrets：
1. GitHub → repo Settings → Secrets and variables → Actions → New repository secret
2. Name: `RSSHUB_URL`   Value: `https://biav-rsshub.fly.dev`
3. 在 `.github/workflows/update-news.yml` 的 `collect_global.py` 步骤下添加：
   ```yaml
   env:
     RSSHUB_URL: ${{ secrets.RSSHUB_URL }}
   ```

---

### 方案 B：Docker Compose（本地 / VPS / Railway）

适用场景：你有一台 VPS，或者想在本地开发时用自己的 RSSHub。

```bash
cd projects/news/rsshub-deploy
cp .env.example .env
vim .env                          # 填入 cookie

docker compose up -d              # 后台启动
docker compose logs -f rsshub     # 看日志，确认启动成功

# 验证
python ../scripts/test_rsshub.py http://localhost:1200
```

Railway 部署：`railway up`（会自动识别 docker-compose.yml），然后把生成的
`https://<project>.up.railway.app` 写进 GitHub Secrets。

VPS 部署：建议在前面挂 nginx 做 HTTPS + 简单 IP 白名单（只允许 GitHub
Actions runner 网段），避免被路过的人当 RSS 公共代理白嫖。

---

### 方案 C：先活半条命（不部署，删 RSSHub 路由）

如果你现在不想搞部署，可以暂时把所有依赖 RSSHub 的路由全删掉，让管线至少不
报 503 噪音。在 `collector.py` 里把 `RSSHUB_ROUTES` 只保留 telegram 那一条，
或者在 `collect_global.py` 的 `all_fetchers` 里把 `('RSSHub', c.fetch_rsshub)`
注释掉。

---

## 部署后需要维护什么

1. **Cookie 会过期**：weibo/zhihu/xhs 的 cookie 一般 1~3 个月过期一次。
   test_rsshub.py 会先发现症状（路由变 EMPTY），那时重新登录抓 cookie 再
   `flyctl secrets set` 一下即可。
2. **RSSHub 版本更新**：`diygod/rsshub:chromium-bundled` 是滚动更新 tag。
   fly.io 重新 deploy 会拉最新版。偶尔遇到 breaking change 时可以 pin 到
   具体 sha256。
3. **Fly.io 计费**：目前配置是 `auto_stop_machines=true` + 512MB。空闲
   时机器停转不计费，每小时 aggregator 起一次 ~5s 冷启动。月成本预计 $0~2。

## 参考

- RSSHub 官方文档：https://docs.rsshub.app/
- RSSHub 部署指南：https://docs.rsshub.app/deploy/
- 各路由所需凭据：`.env.example`
- 我们实际用到的路由清单：`report-system/scripts/collector.py` 里的
  `RSSHUB_ROUTES`
