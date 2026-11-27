# 上架到插件市场

市场的插件列表**不在市场仓库里**，在精选列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。市场（dshmarket.com / awesome-dsh-plugin.com）每天从那儿拉一次，收录通常一天内生效。

所以上架 = **先让包能被安装，再往列表提一条**。

## 路线 A：GitHub 源码（有 GitHub 账号就能走）

1. 建仓 `dsh-peak-coach`，把本目录推上去（`.tgz` 不用推）
2. 去 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，在插件列表里加一条，内容就是本目录的 `catalog-entry.yml` —— 把 `OWNER` 换成你的 GitHub 用户名：

```yaml
url: https://github.com/你的用户名/dsh-peak-coach
name: 你的用户名/dsh-peak-coach
category: agent
description:
  en: '...'
  zh: '...'
```

3. 市场会从 GitHub 拉源码装（比 npm 慢一点，但不需要 npm 账号）

## 路线 B：npm（要 npm 账号，装得快）

```bash
cd F:\DSH\peak-coach
npm adduser        # 一次性，浏览器登录
npm publish        # 发 dsh-peak-coach@1.0.2
```

确认：

```bash
npm view dsh-peak-coach version
```

然后同样去 awesome-dsh-plugin 提 PR。

## 发版注意

- 每次改代码 → 改 `package.json` 的 `version` → 重新打包 / `npm publish`
- `files` 清单决定打进去的东西；`locale/*.json`、`icon.svg`、`docs/` 都要在
- 本地目录安装是 Junction，改完源码刷新即可；**从 npm 装是拷贝，改完必须发新版本**

## 别人怎么装

分发包 `dsh-peak-coach-1.0.2.tgz` 可以直接给：

- 插件页 → 添加插件 → 选这个 tgz
- 或 `dsh plugin add ./dsh-peak-coach-1.0.2.tgz`
- npm 发布后：`dsh plugin add dsh-peak-coach`

## 打包与自测

环境里没有全局 pnpm，用运行时那个：

```powershell
$pnpm = 'C:\Users\60361\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$node = 'C:\Users\60361\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node $pnpm pack          # 看 Tarball Contents 有没有漏文件
node test-peak.mjs          # 峰谷判定 + 拦截决策 19 项
```

装完在峰时摸一次 `write`（有用户指令时应当放行），再确认 `peak_unlock` 能出来。
