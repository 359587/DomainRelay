# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式，版本号采用语义化版本格式。

## [Unreleased]

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
