# Domain Relay

[![CI](https://github.com/359587/DomainRelay/actions/workflows/ci.yml/badge.svg)](https://github.com/359587/DomainRelay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-168354.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/platform-macOS-111827.svg?logo=apple)](https://www.apple.com/macos/)

Domain Relay 是一个面向 macOS 的本地域名代理管理器。它把用户维护的域名和代理出口生成成 PAC 文件，只改写明确配置的域名；所有未匹配域名返回 `DIRECT`，继续交给 macOS 当前路由表处理。

这意味着它通常可以与通过路由表接管流量的企业 VPN 共存，不需要实现或安装新的 VPN/TUN 内核。

> A local macOS PAC manager for routing selected domains and explicitly launched apps through configurable HTTP, HTTPS, or SOCKS5 proxies.

![Domain Relay 应用代理界面](docs/images/application-proxy.png)

## 当前能力

- 管理多个 HTTP、HTTPS 或 SOCKS5 代理出口。
- 将不同域名映射到不同代理，并允许每条规则单独选择“主域名 + 子域名”或“仅此域名”。
- 支持粘贴或读取 `.txt` 批量导入域名，并在导入前预览匹配方式。
- 仅在 `127.0.0.1` 上提供 PAC 和计量转发代理，不监听局域网地址。
- 可选择 Codex 等 macOS 应用并从 Domain Relay 启动，为应用及其子进程注入本地代理环境，覆盖不读取系统 PAC 的网络栈。
- 应用代理模式下，未命中域名由本地转发器直接连接，仍沿用 macOS 路由表或路由型 VPN。
- 同时选择一个或多个要修改的 macOS 网络服务，并分别配置 PAC 与流量转发端口。
- 实时显示代理上下行速率、活动连接和最近经过代理的具体域名。
- 按域名汇总今天、近 7 天、近 30 天或全部历史，并保留最近 90 天连接记录。
- 应用前备份全部所选网络服务原有的自动代理状态。
- 对每个 HTTP、HTTPS 或 SOCKS5 代理执行真实连通性测试，并显示延迟或认证要求。
- 系统设置、代理服务器和域名规则使用独立页签，长列表只滚动当前内容页。
- 自动识别并标记当前默认网络入口，避免选中名称相近但未承载流量的网卡。
- 连接诊断会逐项检查当前入口、PAC、域名规则和目标域名代理隧道。
- 单实例运行，避免多个进程争用本地 PAC 端口。
- 显式恢复原设置；如果自动代理已被其他软件改写，不会强行覆盖它。
- 配置文件采用原子写入，权限固定为 `0600`。
- 菜单栏驻留；关闭窗口不会让已启用的 PAC 服务失效。
- 系统 PAC 启用时可直接关闭窗口并留在菜单栏，日常关闭无需再次授权；只有恢复系统设置或完全退出时才需要管理员授权。
- 打包版本启用规则后会配置为登录时启动，恢复后取消。

## 工作方式

```text
遵循系统 PAC 的应用
   ├── 域名命中 ──► 127.0.0.1 计量转发 ──► 指定 HTTP / HTTPS / SOCKS5 上游代理
   └── 未命中 ────► DIRECT ─────────────► macOS 路由表 / 路由型 VPN

从 Domain Relay 启动的应用及子进程
   └── 本地显式代理 ─► 127.0.0.1 计量转发
                         ├── 域名命中 ──► 指定上游代理
                         └── 未命中 ────► DIRECT ─► macOS 路由表 / 路由型 VPN
```

PAC 是系统代理配置，不是透明代理：只有遵循 macOS 自动代理设置的应用才会使用它。计量转发器不会解密 HTTPS，只能从 CONNECT 看到目标域名并统计隧道字节。

## 开发

要求：macOS、Node.js 22+、pnpm 10+、Xcode Command Line Tools。

```bash
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm typecheck
pnpm test
pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac
```

开发版和当前产物未签名、未公证，只适合本机验证。面向其他电脑分发前，需要配置 Apple Developer ID 完成签名和 notarization。

## 使用步骤

1. 选择要应用 PAC 的网络服务，通常是 `Wi-Fi` 或有线网卡。
2. 配置一个或多个代理服务器。
3. 添加域名并选择对应代理出口；也可以点击“批量导入”，粘贴域名或选择 `.txt` 文件。
4. 保存后点击“应用到 macOS”，通过管理员授权。
5. 日常关闭窗口后应用会留在菜单栏，不需要再次授权。确实要完全退出时，选择“恢复并完全退出”，macOS 会请求管理员授权并恢复原设置。

### 管理员授权与 Touch ID

- “应用到 macOS”和“恢复系统设置”会修改系统 PAC，macOS 要求管理员授权；多张网卡会合并为一次授权。
- 保存配置、测试代理、查看流量以及“应用代理”模式都不会修改系统网络设置，不需要管理员密码。
- Domain Relay 不能强制把 macOS 的管理员密码窗口改成 Touch ID。是否提供 Touch ID 由系统授权策略和公司设备管理策略决定。
- 不会保存管理员密码，也不会修改 `sudoers` 或 PAM 来实现永久免密。

### Codex 等不读取 PAC 的应用

1. 在“应用代理”中点击“添加应用”，选择 `/Applications/ChatGPT.app`。Domain Relay 会将它识别为 Codex。
2. 如果 Codex 已经运行，请先用 `Command + Q` 完全退出；仅关闭窗口不够。
3. 回到 Domain Relay，点击“通过代理启动”。新启动的 Codex 及其 `codex app-server`、Git 等子进程会使用本地域名规则。
4. 在“流量统计”中确认 `chatgpt.com`、`openai.com`、`oaiusercontent.com` 等实际目标域名出现下行流量。

应用代理不会修改目标应用文件，也不会全局写入 shell 环境。代理变量只注入本次从 Domain Relay 启动的进程树。未配置域名由本地转发器直接连接，不计入代理流量统计。

批量导入会按公共后缀智能判断规则类型：

- 主域名 `google.com` 会保存为 `*.google.com`，同时匹配 `google.com` 本身和全部子域名。
- 具体子域名 `api.google.com` 默认只匹配它自己。
- 显式输入 `*.api.google.com` 时，会匹配该域名及其全部子域名。
- `example.co.uk` 这类包含多级公共后缀的主域名也能正确识别。
- 输入支持每行一条，也支持逗号、分号和空格分隔；URL 会自动提取主机名。

配置与流量历史位于：

```text
~/Library/Application Support/domain-relay/domain-relay.json
~/Library/Application Support/domain-relay/traffic-history.jsonl
```

两个文件权限均固定为 `0600`。不要把包含公司代理地址或访问域名历史的文件提交到代码仓库或发到公共渠道。历史页面可以随时清空记录，正在传输的连接不会被中断。

## 紧急恢复

正常情况下请使用应用内的“恢复原系统设置”。如果应用损坏且系统仍指向本地 PAC，可以在终端关闭对应网络服务的自动代理：

```bash
sudo networksetup -setautoproxystate "Wi-Fi" off
```

将 `Wi-Fi` 替换为实际网络服务名。该命令只关闭自动 PAC，不会关闭 VPN 或手动 HTTP/SOCKS 代理。

## 已知边界

- `DIRECT` 会继续使用系统路由表和路由型 VPN，但不能委托给原来的另一个 PAC。
- 如果网络服务还启用了手动 HTTP/HTTPS/SOCKS 代理，PAC 的 `DIRECT` 不保证继续使用这些手动代理；应用会在启用前提示。
- PAC 不承载代理用户名和密码。需要认证时，由使用代理的系统组件或应用处理认证。
- HTTP/HTTPS CONNECT 代理通常不承载原生 UDP；依赖 UDP/QUIC 的应用需单独验证，或使用支持 UDP 的 SOCKS5 出口。
- 流量统计记录 TCP/HTTP 代理隧道中的上下行字节，不包含 DIRECT 流量，也不代表运营商账单口径。
- HTTPS 统计只记录 CONNECT 目标域名，无法看到加密后的 URL 路径、请求参数或内容。
- 部分应用使用自带网络栈并忽略系统 PAC。此时需要从“应用代理”页面启动；如果应用连显式代理环境也不读取，则仍无法接管。
- 应用必须在注入代理环境后重新创建进程。已经运行的应用和后台进程不会自动切换。
- 不同应用可能缓存 PAC。规则保存后若目标应用没有立即更新，可重启该应用后验证。

## 安全与隐私

- PAC 服务和转发代理只监听 `127.0.0.1`，不会主动暴露到局域网。
- 配置与流量历史只保存在本机，不包含遥测或云端同步逻辑。
- 提交 Issue 或日志前，请移除真实代理地址、用户名、密码、公司域名和访问历史。
- 安全漏洞请不要公开披露，按 [SECURITY.md](SECURITY.md) 使用 GitHub 私密漏洞报告。

## 参与贡献

欢迎提交问题与改进。开始前请阅读 [贡献指南](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md) 和 [架构说明](docs/ARCHITECTURE.md)。版本变化记录在 [CHANGELOG.md](CHANGELOG.md)。

## 许可证与商标

项目基于 [MIT License](LICENSE) 开源。

Domain Relay 是独立开源项目，与 Apple、OpenAI、ChatGPT 或 Codex 不存在隶属或背书关系；相关名称仅用于说明兼容场景。
