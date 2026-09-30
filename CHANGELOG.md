# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式，版本号采用语义化版本格式。

## [Unreleased]

### Added

- 补充 ad-hoc 本地签名构建与严格校验命令，明确其与 Apple Developer ID 正式签名、公证的区别。

### Fixed

- 托管 macOS 应用改为通过 LaunchServices 启动并显式传递代理环境变量，调整直接执行应用二进制文件导致责任应用归到 Domain Relay 的启动方式。
- 系统接受应用启动请求后等待目标进程出现，再标记为代理中；等待超时或启动失败时明确报错，不回退到直接启动应用可执行文件。
- 已启用系统 PAC 时，保存新增或修改后的域名规则会使用内容指纹刷新 PAC 地址，使新连接立即使用最新规则。

## [0.5.2] - 2026-08-26

### Added

- 首次公开源代码版本。
- 按域名生成 PAC，并支持 HTTP、HTTPS 和 SOCKS5 上游代理。
- 支持从 Domain Relay 启动指定 macOS 应用及其子进程。
- 实时和历史代理流量统计、连接诊断与批量域名导入。
- 多网络服务 PAC 状态备份、冲突检测与显式恢复。

### Security

- PAC 与转发服务仅监听 loopback。
- 配置和流量历史采用原子写入并固定为 `0600` 权限。
- 多网络服务变更合并为一次 macOS 管理员授权。

[Unreleased]: https://github.com/359587/DomainRelay/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/359587/DomainRelay/releases/tag/v0.5.2
