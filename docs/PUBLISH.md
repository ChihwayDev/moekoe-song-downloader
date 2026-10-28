# 手动发布到 GitHub

这份说明用于手动上传源码和创建 Release。本项目提供的脚本只整理本地文件及构建测试，不会代替你创建 GitHub 仓库或发布版本。

## 建议的仓库信息

- 仓库名：`moekoe-song-downloader`
- Description：`MoeKoe Music 歌曲保存插件：单曲与歌单、自选音质和目录、可拖动面板。个人学习研究项目，适用于 Windows。`
- Topics：`moekoemusic`、`electron`、`music`、`plugin`、`learning-project`、`windows`

作者名字、GitHub 账号和远端仓库链接由发布者填写，当前材料没有虚构这些信息。

## 上传源码

1. 创建仓库。使用已经准备好的 README 等文件时，创建页面可以不额外生成 README、`.gitignore` 或另一份许可证，以免重复。
2. 解压 `moekoe-song-downloader-v0.2.0-source.zip`。
3. 进入解压后的顶层 `moekoe-song-downloader` 文件夹，将**里面的文件和子文件夹**上传到仓库根目录。应包含 `.github`、`.gitignore` 等以点开头的文件。
4. 不要把整个本地开发工作区上传；工作区中的参考客户端源码、测试配置和运行环境已经从源码包排除。
5. 上传后检查仓库首页是否正确显示项目说明。新增的工作流会构建和测试插件，但远端执行结果需要在 GitHub Actions 页面查看。

## 创建 v0.2.0 Release

1. 在仓库页面进入 **Releases → Draft a new release**。
2. Tag 填写 `v0.2.0`，Target 选择保存源码的分支，例如 `main`。
3. 标题填写 `v0.2.0 — 歌单下载、自选目录与音质`。
4. 正文可复制 [`RELEASE-v0.2.0.md`](RELEASE-v0.2.0.md)。
5. 在附件区域上传 `moekoe-song-downloader-v0.2.0.zip`、`moekoe-song-downloader-v0.2.0-source.zip` 及各自的 `.sha256` 校验文件。
6. 检查附件和内容后自行点击发布，或者先保存为草稿。

安装用户应下载附加的**插件 ZIP**。GitHub 自动生成的 `Source code (zip)` 是开发源码，不含编译后的 Windows 保存组件，不能直接当作插件安装包导入。

## 用途和许可证

README 已按个人学习研究用途描述实际功能，并说明使用播放地址、没有单独核验下载权益等能力边界。“个人学习研究”是项目用途说明；代码许可应以发布者选定并放入仓库的 `LICENSE` 为准。

作者已选择 **GPL-2.0-only**。上传源码时保留根目录 `LICENSE`；发布二进制插件包时同时提供对应源码。建议把准备好的源码 ZIP 也附加到同一个 Release，便于接收者获取完整源码和构建脚本。

GPL-2.0-only 允许商业使用；本项目的“个人学习研究”用途表述没有加入与该许可证冲突的“禁止商用”条件。

参考：[GitHub 官方 Release 创建说明](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。
