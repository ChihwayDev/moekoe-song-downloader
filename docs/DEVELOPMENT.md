# 本地开发

需要 Windows、Node.js 20 或更高版本，以及 Windows .NET Framework 的 C# 编译器。项目自动测试使用 Node.js 24 验证；前端运行时没有 npm 依赖。

## 编译、测试和生成安装包

在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-native.ps1
node --test tests/core.test.cjs tests/data.test.cjs tests/native.test.cjs tests/page-bridge.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1
```

生成 `dist/moekoe-song-downloader-v0.2.0.zip` 及其 `.sha256` 校验文件。源码仓库忽略编译后的 `.exe`；安装包会包含保存组件。

## 客户端集成验证

本地必须已安装 MoeKoe Music 1.7.1，以及可用的 FFmpeg。先生成不涉及在线歌曲的测试音频：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-audio-fixtures.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/prepare-electron-test.ps1 -InstalledDirectory '你的 MoeKoe Music 安装目录'
```

然后运行 `.verification/runtime/MoeKoe Music.exe`，会使用独立的测试用户目录、原始客户端的样式、preload 和本地程序管理器验证插件。

集成验证中的账户和歌曲接口返回使用本地测试数据。系统目录选择接口返回预设测试目录，覆盖选择、取消和更换目录的处理。测试结果保存在 `.verification/report-v2.json`，本地截图和下载文件也保存在 `.verification/` 下。

自动测试不等于对所有在线歌单、账户权限和音源的实际验证。GitHub 的构建工作流只运行本地自动测试，不运行需要安装 MoeKoe 的完整客户端验证，也不自动创建 Release。

## 导出干净的发布源码

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package-source.ps1
```

导出脚本使用明确的源码目录清单，排除 `.verification/`、开发时参考的 `MoeKoeMusic/`、生成的音频、编译文件和 `dist/`，并验证 ZIP 内容与源文件一致。输出源码 ZIP 和相对路径清单，供手动上传 GitHub。

## 贡献

提交问题时提供 MoeKoe 版本、插件版本、操作步骤和删去隐私信息后的错误提示。修改代码后运行相关自动测试；涉及客户端接口或面板行为时，在独立测试目录进行集成验证。请保持下载能力边界和测试结果说明准确。
