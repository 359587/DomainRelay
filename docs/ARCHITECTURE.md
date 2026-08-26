# 架构说明

Domain Relay 是一个 Electron 应用，由渲染进程、受限 preload API 和主进程网络模块组成。所有系统网络修改都发生在主进程。

```text
React renderer
      │ typed IPC via preload
      ▼
Electron main process
      ├── config-store ────── 本地配置与原子写入
      ├── pac / pac-server ── 规则生成与 loopback PAC 服务
      ├── traffic-proxy ───── HTTP/CONNECT/SOCKS5 转发
      ├── traffic-monitor ─── 本地流量历史与聚合
      ├── network ─────────── networksetup 状态读取、应用与恢复
      └── application-launcher ─ 为指定应用进程树注入代理环境
```

## 核心数据流

1. 用户在渲染进程编辑代理、域名和网络服务配置。
2. 主进程校验并保存配置，生成 PAC 规则。
3. 本地 PAC 服务和计量转发器只监听 `127.0.0.1`。
4. 应用系统 PAC 时，主进程先记录各网络服务原状态，再通过一次 macOS 管理员授权执行变更。
5. 恢复时仅回滚仍由 Domain Relay 管理的状态，避免覆盖其他软件的后续改动。
6. 对不读取系统 PAC 的应用，应用启动器只向本次新进程树注入代理环境，不修改应用文件或全局 shell 配置。

## 模块边界

- `src/renderer`：界面和用户交互，不直接访问 Node.js 或系统命令。
- `src/preload`：暴露最小、类型化的 IPC 接口。
- `src/main`：生命周期、IPC、PAC、转发、诊断、存储和系统集成。
- `src/shared`：主进程与渲染进程共享的数据类型和域名规则逻辑。
- `tests`：纯逻辑、存储、PAC、网络恢复计划、应用启动和流量转发测试。

## 安全原则

- 本地服务默认拒绝非 loopback 暴露。
- 不保存管理员密码，不修改 `sudoers` 或 PAM。
- 用户配置和流量历史权限为 `0600`。
- HTTPS 只转发 CONNECT 隧道，不解密内容。
- 系统状态变化必须可预测、可诊断、可恢复。

涉及这些边界的改动应附单元测试和人工恢复验证说明。
