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
- 验证是否打包进产物要 **`grep -i`**：CSS 压缩器会把字体名转小写（`microsoft yahei`），
  大小写敏感 grep 会误报"没生效"。
- 项目级 `layouts/_partials/*.html` 的 partial 覆盖在当前 Hugo 0.167 + PaperMod 组合下
  **不生效**（已实测），样式一律走上面的 CSS 通道。

## Backlog（第一篇文章上线前不动）

主题样式定制、关于页、评论、访问统计、自定义域名、Cloudflare 前置（大陆访问优化）。
