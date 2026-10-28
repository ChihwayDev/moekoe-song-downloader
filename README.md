# MoeKoe 歌曲下载

为 [MoeKoe Music](https://github.com/MoeKoeMusic/MoeKoeMusic) 编写的个人学习研究插件，用于探索播放器扩展、音频网络传输及本地文件保存。

**当前版本：0.2.0。适用于 Windows 版 MoeKoe Music 1.7.1。** 本项目由个人维护，与 MoeKoe Music 及音乐服务提供方没有官方隶属关系。

## 功能

- 下载当前播放歌曲，或读取完整歌单后全选 / 勾选部分歌曲。
- 选择标准、320 kbps、FLAC、Hi-Res 或接口标记的最高可用音质。
- 使用系统窗口选择保存目录，并记住选择；歌单可单独创建子文件夹。
- 面板默认放在左侧，可拖动、记忆位置或切换左 / 中 / 右预设。
- 显示下载进度与结果，支持取消，同名文件自动添加后缀。

## 安装与使用

在本仓库的 **Releases** 页面下载附件 `moekoe-song-downloader-v0.2.0.zip`。GitHub 自动生成的源码压缩包用于开发，不包含编译后的保存组件。

1. 打开 MoeKoe Music → 设置 → 插件，导入插件 ZIP；已有 0.1.0 时先卸载旧版本。
2. 在插件的本地程序权限区域授权 `song-downloader-saver`，使其能够写入你选择的文件夹。
3. 完全退出并重新启动客户端，点击播放器上的下载按钮。
4. 选择保存文件夹和音质。歌单模式可点击「刷新」选择我的歌单，或读取当前页面打开的歌单。

详细操作见 [插件使用说明](moekoe-song-downloader/README.md)。

## 项目用途与能力边界

本项目以个人学习研究和技术交流为目的。它沿用 MoeKoe 当前登录状态及配置的 API，获取播放资源地址后保存接口实际返回的音频。

当前实现**没有单独核验平台规定的下载权益**；播放地址可访问不等于取得了平台另行规定的下载授权。项目没有实现会员身份伪造、DRM 解密或额外资源授权。可用音质、试听范围、访问限制和地址有效期均取决于接口返回。

请仅处理你有权保存的音频；项目不提供歌曲内容、共享账户或账户凭据。学习研究用途说明不替代具体资源授权。

## 开发与构建

运行插件不需要 Node.js。开发验证需要 Windows、Node.js 20+ 以及 .NET Framework C# 编译器，前端没有 npm 依赖。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-native.ps1
node --test tests/core.test.cjs tests/data.test.cjs tests/native.test.cjs tests/page-bridge.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1
```

安装包生成在 `dist/`。保存程序由 `native/SongSaver.cs` 编译，使用 MoeKoe 的本地程序接口管理；源码仓库不包含生成的 `.exe`。

```text
moekoe-song-downloader/   插件界面、歌曲处理和桥接脚本
native/                   Windows 保存程序源码
tests/                    自动测试与独立客户端验证
tools/                    编译、测试素材生成和打包脚本
docs/                     开发、实现与手动发布说明
```

## 验证情况

0.2.0 已在本地通过 **33 项自动测试和 14 项独立客户端验证**。测试使用本地生成的 WAV、MP3、FLAC 及模拟歌曲接口；并不表示全部在线歌曲或账户权限已逐一验证。

GitHub 工作流只负责 Windows 构建、自动测试和保留测试产物，**Release 由作者手动发布**。远端工作流的实际结果需上传仓库后查看。

## 文档

- [实现说明](docs/IMPLEMENTATION.md)
- [数据与权限说明](PRIVACY.md)
- [开发、测试和源码导出](docs/DEVELOPMENT.md)
- [手动发布到 GitHub](docs/PUBLISH.md)
- [更新记录](CHANGELOG.md)

## 致谢

感谢 [MoeKoe Music](https://github.com/MoeKoeMusic/MoeKoeMusic) 提供插件系统和开发参考。本仓库仅包含该插件的源码；开发时使用的客户端参考副本、运行环境和用户配置不纳入发布源码。

## 许可证

本项目采用 **GNU General Public License v2.0 only（GPL-2.0-only）**，完整条款见 [LICENSE](LICENSE)。

“个人学习研究、兴趣驱动”描述的是项目初衷；代码的使用、修改和再分发按 GPL-2.0-only 执行。发布的插件安装包包含保存组件源码，仓库提供其余源码、测试及构建脚本。
