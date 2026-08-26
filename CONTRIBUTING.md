# 贡献指南

感谢你愿意帮助改进 Domain Relay。项目直接修改 macOS 网络代理设置，因此可恢复性、最小权限和可验证性优先于功能数量。

## 开始开发

要求：macOS、Node.js 22+、pnpm 10+、Xcode Command Line Tools。

```bash
git clone https://github.com/359587/DomainRelay.git
cd DomainRelay
pnpm install
pnpm dev
```

提交改动前运行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 提交 Issue

- Bug 请提供 macOS 版本、芯片架构、Domain Relay 版本、代理类型和最小复现步骤。
- 日志和截图必须移除真实代理地址、账号、密码、公司域名及访问历史。
- 安全问题不要创建公开 Issue，请按 [SECURITY.md](SECURITY.md) 私密报告。

## Pull Request 要求

1. 每个 PR 聚焦一个问题，说明行为变化和验证方法。
2. 网络设置、PAC、转发器或应用启动链路的改动必须补充测试。
3. 不得削弱恢复流程、配置文件 `0600` 权限或仅监听 loopback 的安全边界。
4. 新增依赖前说明必要性、许可证和对打包体积的影响。
5. UI 改动请附截图；涉及系统授权时同时说明失败和取消路径。

项目不要求固定的提交信息格式，但标题应清楚说明结果，例如 `fix: preserve PAC state when quitting`。

提交 PR 即表示你同意按照本项目的 MIT License 许可你的贡献。
