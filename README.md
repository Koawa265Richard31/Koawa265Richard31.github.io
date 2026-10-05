# 个人博客（Hugo + GitHub Pages）

## 本地工作流

```bash
hugo server -D    # 预览（含草稿）http://localhost:1313
```

文章草稿：`content/posts/agent-result-delivery-r1-r5.md`（`draft: true`，构建不含草稿，
发布时把 `draft: true` 删掉）。文章顶部 HTML 注释里有叙事骨架和发布前脱敏 gate，别删。

## 剩余手动步骤（一次性）

1. **装 Hugo Extended**（本机尚未装）：
   ```powershell
   winget install Hugo.Hugo.Extended
   hugo version   # 记下版本号，填进 .github/workflows/hugo.yml 的 hugo-version（替换 "latest"）
   ```
2. **GitHub 建仓库**：名字必须是 `Koawa265Richard31.github.io`，Public。
3. **推送并启用 Pages**：
   ```bash
   git remote add origin https://github.com/Koawa265Richard31/Koawa265Richard31.github.io.git
   git push -u origin main
   ```
   然后仓库 Settings → Pages → Source 选 **GitHub Actions**。
4. **（可选，之后再说）自定义域名**：DNS 加 CNAME `blog.<你的域名>` → `Koawa265Richard31.github.io`；
   Settings → Pages → Custom domain 填入并等证书就绪后勾 Enforce HTTPS；
   同步把 `hugo.toml` 的 baseURL 改成 `https://blog.<你的域名>/`。

## 注意：git 代理

全局配置当前指向 `127.0.0.1:7890`（未监听，克隆会失败）。若 push 失败，二选一：

```bash
git config --global http.https://github.com.proxy http://127.0.0.1:7897   # 改成当前活端口
git -c http.https://github.com.proxy=http://127.0.0.1:7897 push -u origin main   # 或临时覆盖
```

## 自定义样式（踩坑记录）

- 自定义 CSS 放 **`assets/css/extended/*.css`**（PaperMod 官方通道，自动并入主题样式表）。
- 自定义 head 内容（内联样式/JS，如滚动动画）放 **`layouts/_partials/extend_head.html`**——该通道
  2026-10-04 复验**生效**；此前误判为不生效，原因是双假阴性：HTML 压缩器会删除注释探针、
  CSS 压缩器会把值小写化，而当时用大小写敏感 grep 验证。
- 验证是否打包进产物一律 **`grep -i`**，探针别用 HTML 注释（会被压缩删除），用 CSS 规则当标记。

## 配置速查表（改哪儿找这儿）

| 想改什么 | 文件 | 位置/字段 |
|---|---|---|
| 浏览器标签页站名 | `hugo.toml` | `title` |
| 侧栏顶部站名 | `layouts/_partials/extend_footer.html` | `.sidebar-title` 一行 |
| 头像 | `static/images/avatar.jpg` | 直接换文件（同名覆盖） |
| 侧栏名字 | `layouts/_partials/extend_footer.html` | `.profile-name` |
| 侧栏菜单/链接 | 同上 | `.profile-links` 里的 `<a href="…">` 列表 |
| 背景图 | `assets/css/extended/glass-cards.css` | `--bg-image` 一行 + 图放 `static/images/` |
| 玻璃透明度档位 | `layouts/_partials/extend_footer.html` | JS 里 `LEVELS = [...]` 数组 |
| 玻璃模糊/圆角 | `assets/css/extended/glass-cards.css` | `--glass-blur` / `--card-radius` |
| 深色玻璃配色 | 同上 | `html.card-dark { … }` 段 |
| 页脚版权行 | `hugo.toml` | `copyright` |
| 文章作者名 | `hugo.toml` | `author`（params 段） |
| 网站描述（SEO） | `hugo.toml` | `description` |
| 自我介绍 | `content/about.md` | 正文（含画师署名） |
| 写新文章 | `content/posts/xxx.md` | front matter：`title/date/tags/draft` |
| 侧栏宽度/内容列宽度 | `assets/css/extended/glass-cards.css` | `--sidebar-w` / `--mw` 那几行 |

## 交互动画组件：意识空间（consciousness-space，v2 · CDN 栈）

CDN UMD 栈：3d-force-graph@1.73.6（**必须钉版本**，1.80.x UMD 有打包 bug
`Zz.Timer is not a constructor`）+ three@0.150.1 + tsparticles@2.12.0。
两阶段叙事：TubeGeometry 按弧长逐段生长 → 力导向网络（弧连线+流动粒子）接管；
悬停意识点高亮其簇，点击高亮与主干共享段。

```markdown
{{</* consciousness-space */>}}                                  ← 默认 560px
{{</* consciousness-space height="600" seed="11" members="6" dust="80" caption="图 2" */>}}
```

| 想改什么 | 文件 | 位置/字段 |
|---|---|---|
| 簇数量（2^LEVELS） | `static/js/consciousness-space.js` | 顶部 `LEVELS` / `BASE_LEN` |
| 生长速度 | 同上 | `GROW_V`（弧长单位/秒） |
| 簇配色 | 同上 | `CLUSTER_COLORS` |
| 每簇意识点数 / 尘埃数 | shortcode 属性 | `members` / `dust` |
| 调试句柄（验收用） | 页面元素 | `el.__csDiag`（growS/pick/forceGrown） |

## 交互动画组件：意识流形（manifold-viz，v1 · 纯 Canvas）

自包含 Vanilla Canvas 组件（零依赖、Shadow DOM 样式隔离、移动端自适应、离屏暂停）。
在任意文章里一行调用：

```markdown
{{</* manifold-viz */>}}                                        ← 默认：高 480px、种子 7
{{</* manifold-viz height="540" seed="11" */>}}                 ← 换高度 / 换一棵树
{{</* manifold-viz height="420" seed="7" caption="图 2" */>}}   ← 带图注
```

| 想改什么 | 文件 | 位置/字段 |
|---|---|---|
| 调色板（蓝→靛→紫→琥珀） | `static/js/manifold-viz.js` | 顶部 `PALETTE` 数组 |
| 分叉层数 / 生长速度 | 同上 | `DEPTH_MAX` / `GROW_V` |
| 粒子数量 | 同上 | `N_FLOW` / `N_DUST`（合计 260 ≤ 1000 预算） |
| 初始张角范围 | 同上 | `DTHETA`（恒 < 0.01 rad，微观分歧语义） |
| 演示文章（草稿，未发布） | `content/posts/consciousness-manifold-demo.md` | `draft: true` |

交互：拖动旋转（惯性）· 双击复位 · 悬停/轻点分支点显示 t₀ 与 Δθ；
尊重系统"减少动态效果"；`hugo server -D` 本地预览演示文。

## Backlog（第一篇文章上线前不动）

主题样式定制、关于页、评论、访问统计、自定义域名、Cloudflare 前置（大陆访问优化）。
