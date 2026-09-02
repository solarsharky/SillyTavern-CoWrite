# 共笔（CoWrite）

一个面向中文 SillyTavern 用户的独立共创记录扩展。你可以和当前角色轮流答问卷、评价彼此的答案，或持续写交换日记；所有内容都留在共笔工作区，不会新增、修改聊天楼层。

> 当前版本：`v0.1.0-beta.1`。这是公开测试版，请先备份重要记录再更新。

## 环境要求

- SillyTavern `1.17.0` 或更高版本
- [酒馆助手 / JS-Slash-Runner](https://gitlab.com/novi028/JS-Slash-Runner) `4.9.3` 或更高版本
- 当前版本只支持单角色聊天；群聊中只能只读浏览记录
- 中文界面

## 安装

1. 确保酒馆助手已经安装并启用。
2. 打开 SillyTavern 的“扩展”面板，选择“安装扩展”。
3. 粘贴仓库地址：

   ```text
   https://github.com/solarsharky/SillyTavern-CoWrite
   ```

4. 安装后重新加载页面。右侧会出现可拖拽的“共”字悬浮按钮。

仓库的 `main` 分支始终保留可直接安装的 `manifest.json` 与已构建 `dist/`，不需要在本地安装 Node.js。

## 三种内置玩法

### 双人问卷

Char 先准备一组混合题型，User 手动填写；下一轮 Char 给出自己的答案，双方再评价彼此。题目数量、顺序和每一阶段的行为都可以复制模板后修改。

### Char 给 User 的问卷

Char 以自己的口吻出题，User 使用短答、长答、单选、多选或量表作答。继续生成后，Char 会逐题评价并写总结。

### 交换日记

Char 写开篇，User 接着手写一页。此后每次“继续写一轮”都会让 Char 回应上一页、写下自己的下一篇，再留出新的 User 长文本位置。User 可以随时手动完成或开启“下一卷”。

## 数据与安全

- 主数据使用 SillyTavern 账户文件：`cowrite-catalog.json`、`cowrite-templates.json` 和独立的 `cowrite-record-<uuid>.json`。
- 浏览器本地会保存缓存和未同步草稿。服务器保存失败时，界面会明确显示“未同步”，刷新后仍可恢复并再次保存。
- 自定义 API Key 默认只存在当前页面会话。只有主动勾选“记住密钥”后，密钥才会以明文保存在当前浏览器本地。
- API Key 不会进入账户文件、整库备份、模板/记录导出、构建产物或共笔日志。提交 Issue 前仍请自行检查并脱敏浏览器控制台内容。
- 独立连接会把你选择的角色卡、Persona、场景、近期聊天、世界书和当前记录发送给对应 API 服务。只应使用你信任的服务商和 Base URL。
- AI 输出只能追加 Char 内容、评价与空白 User 输入卡；不能覆盖已有 User 答案。无效输出会自动修复一次，仍失败则不会修改记录，并可下载原始响应排查。

## 备份与恢复

进入“设置 → 备份与恢复”，点击“下载整库备份”。备份是带 `schemaVersion` 的 JSON，包含所有自定义模板、记录和不含密钥的设置。导入时会校验结构，并为冲突的模板/记录 ID 自动生成新 ID。

单份记录可从记录库导出 JSON 或 Markdown；单个模板也可以单独导入、导出。建议在更新扩展、清理浏览器数据或批量整理记录之前下载整库备份。

## 模板与上下文

模板由“共同规则＋首轮提示词＋继续提示词”组成，支持 `{{char}}`、`{{user}}`、`{{round}}` 和 `{{record_title}}` 变量。可以预览最终提示词、选择近期聊天数量、当前激活世界书或手选世界书条目，并为模板指定连接。

核心 JSON 协议默认只读。高级模式允许在确认风险后覆盖协议，但结构校验、User 内容保护、引用校验和追加事务不能关闭。

记录超过 `min(12,000 tokens, ST 最大上下文的 40%, 模板记录预算)` 后，共笔会先为较早轮次生成滚动摘要；后续请求仅发送摘要、最近三轮及尚未回答/评价的输入，完整历史仍保存在记录文件中。摘要失败时不会继续主生成，可以重试或创建“下一卷”。

## 开发

```bash
npm install
npm run check
```

源码采用 Vue 3、TypeScript、Pinia、Zod、Vite、Vitest。`npm run build` 会生成需要提交的 `dist/index.js` 和 `dist/index.css`。CI 会检查提交的构建产物是否和源码一致。

## 反馈

- [提交 Bug](https://github.com/solarsharky/SillyTavern-CoWrite/issues/new?template=bug_report.yml)
- [提出功能建议](https://github.com/solarsharky/SillyTavern-CoWrite/issues/new?template=feature_request.yml)

Bug 报告请包含 SillyTavern/酒馆助手版本、浏览器、复现步骤和已脱敏日志。请勿提交角色卡私密内容、聊天原文或 API Key。

## 许可

[MIT License](LICENSE) © 2026 SolarShark
