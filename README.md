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

## Backlog（第一篇文章上线前不动）

主题样式定制、关于页、评论、访问统计、自定义域名、Cloudflare 前置（大陆访问优化）。
