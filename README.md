# 世界观 Wiki（本地静态站）

《基础设定》的结构化 wiki。**与 qq-bridge 的角色卡（`roles/*.md`）完全无关**——这里只存世界观，不参与任何 QQ 会话注入。

## 打开方式

**方式一：直接双击（零依赖）**

```
site/index.html
```

站点**完全自包含**（零外部依赖、无 CDN、无字体、无图片请求），可离线打开，也可整个 `site/` 目录直接分享给他人。

**方式二：本地服务（推荐，链接与搜索体验一致）**

```
双击 打开wiki.bat
```

然后浏览器访问 `http://127.0.0.1:8899/`。按 `/` 聚焦搜索框，`↑` `↓` 选结果，`Enter` 跳转。

> 服务默认只绑定 `127.0.0.1`，**仅本机可访问**。若需同局域网访问，见下方「局域网访问」。

## 目录结构

```
wiki/
├── content/           # 内容源（Markdown + front matter）——改这里
│   ├── index.md                首页（含世界结构、六条硬约束、能量规则、力量体系、
│   │                           存在等级、用词提醒、历史主轴、时代主题、阅读指引）
│   ├── world.md                四层世界（群星/现世/边境/旧域）
│   ├── passage.md              四层通行
│   ├── essence.md              源质
│   ├── law.md                  律法
│   ├── sorcerer.md             术士
│   ├── power-system.md         能力体系（位阶的四个阶段）
│   ├── correction.md           修正值
│   ├── artifact-relic.md       遗物
│   ├── alchemy.md              炼金学
│   ├── alchemy-arms.md         炼金武装
│   ├── essence-economy.md      辉石经济
│   ├── race-human.md           人类
│   ├── race-fantasy.md         奇幻种
│   ├── race-dragonkin.md       龙裔
│   ├── new-gods.md             新神
│   ├── old-kings.md            旧王
│   ├── outer-gods.md           外神
│   ├── calamity.md             天灾
│   ├── timeline.md             时间线
│   ├── history-official.md     官方叙事与真实版本
│   ├── federation.md           新合众国
│   └── glossary.md             术语索引
├── build.mjs              # 构建脚本（零依赖，需 Node.js）
├── 打开wiki.bat            # 一键构建 + 起本地服务
├── 手动更新并打包.bat       # 一键构建 + 打 Netlify 部署包
└── site/                  # 构建产物（自动生成，可随时删除重建）
```

> **共 24 篇。** 新增 `content/*.md` 后，还需在 `build.mjs` 的 `NAV_GROUPS` 里登记文件名，否则不会出现在侧边栏。

## 改内容

1. 编辑 `content/` 下的 `.md`。
2. 重新构建：

```
node build.mjs
```

3. 刷新浏览器即可。

### front matter 字段

```yaml
---
title: 术士            # 页面标题（必填）
category: 核心规则      # 侧边栏分组标签
summary: 一句话摘要      # 显示在侧边栏与搜索结果
keywords: [术士]       # 术语自动互链关键词；留空 [] 表示不参与
tags: [核心规则]       # 标题下方的标签
updated: 2026-09-15    # 可选
autolink: false        # 可选；索引类页面建议设为 false
---
```

### 写法约定

- **内部链接**：`[律法](law.md)`，构建时自动转成 `law.html`；带锚点写 `[群星](world.md#群星)`。
- **术语自动互链**：正文里出现 `keywords` 中声明的词（如"修正值""原初律法"）会自动变成链接，无需手写。
- **原文块**：保持 `**原文**` + 空行 + 原文段落的形式，方便校对。
- **表格**：标准 Markdown 表格即可，构建时会包一层可横向滚动的容器。
- **锚点**：标题（`##`/`###`）自动生成锚点，悬停显示 `#` 可复制。

## 内容原则

- 设定正文**逐字保留原始措辞**，整理只做结构：拆条目、加交叉链接、补索引与对照表。
- 新增的表格 / 要点 / 索引均**不引入新设定**；凡属推断的内容应在正文中明确标注为推断，不写入原文块。
- 未展开的名词在相应条目页集中列出（如各页的「尚未展开」小节），避免后续创作时被误当成既成设定。
- **口径变更须在全站对齐**：同一设定若改了表述，所有引用处一并更新，并检查交叉链接是否失效。

## 构建脚本能做什么

| 命令 | 作用 |
|---|---|
| `node build.mjs` | 构建到 `site/` |
| `node build.mjs --serve` | 构建并起服务，默认 `127.0.0.1:8899` |
| `node build.mjs --serve 9000` | 指定端口 |

构建产出：每个条目的 HTML、`style.css`、`app.js`（搜索与键盘操作）、`search-index.js`（检索索引）、`robots.txt`。

> ⚠️ **每次构建都会清空整个 `site/` 目录再重建。** 任何需要长期存在的静态文件都必须写进 `build.mjs`，手工放进 `site/` 会在下次构建时消失。

### 内置的爬虫防护

`build.mjs` 会为站点生成 `robots.txt`（`Disallow: /`），并给每个页面加上 `<meta name="robots" content="noindex,nofollow">`，两层配合防止未公开的设定被搜索引擎收录。

**若要允许收录**：删掉 `build.mjs` 中写 `robots.txt` 的那几行，以及 `pageShell` 模板里的 `<meta name="robots">` 行，然后重新构建。

## 局域网访问

服务默认绑定 `127.0.0.1`（仅本机）。若要让同一局域网内的其他人访问，需要修改 `build.mjs` 中 `server.listen(port, '127.0.0.1', ...)` 的绑定地址（例如改为 `0.0.0.0`），然后用本机内网 IP（`ipconfig` 查看，通常形如 `192.168.x.x`）访问，并允许 Windows 防火墙放行。

## 更新与部署

手动同步到线上托管的最短路径：

1. `node build.mjs`
2. 把 `site/` 里的**全部文件**上传（压缩包内 `index.html` 必须在**根层**）

或直接双击 **`手动更新并打包.bat`**，它会重建站点并在 `wiki/` 下生成 `netlify-deploy.zip`。
