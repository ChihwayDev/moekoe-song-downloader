# 实现说明

## 下载流程

```mermaid
flowchart LR
  A[选择歌曲和音质] --> B[MoeKoe 配置的歌曲 API]
  B --> C[取得音频播放地址]
  C --> D[本地保存组件]
  D --> E[用户选择的文件夹]
```

1. `content.js` 向播放器添加入口，管理任务和设置。单曲来自 `localStorage.current_song`，歌单来自接口分页返回的数据。
2. `data.js` 通过 `/privilege/lite` 取得音质及资源标识，再通过 `/song/url` 获取地址；“当前播放音质”直接沿用播放器已有的地址。歌单通过 `/playlist/track/all` 分页读取，每页 300 首。
3. `page-bridge.js` 在播放器页面上下文中调用内置 `kugouapi.request` 或当前配置的 HTTP API，并使用当前登录状态。接口清单固定为四个读取用途的端点。
4. `bridge.js` 运行于插件页面，通过 MoeKoe 的 `electronAPI.nativeHost` 转发保存请求及进度。保存目录通过客户端的系统文件夹对话框选择。
5. `native/SongSaver.cs` 接收 JSON Lines 消息，分块读取 HTTP 响应、写入 `.part` 文件，检查返回长度和音频文件头后更名。遇到同名文件时添加数字后缀。

## 权限与能力边界

插件使用接口返回的播放资源地址。能够访问播放资源不等于已经取得平台单独规定的下载权益；**当前实现没有单独查询或核验下载权益**。

项目没有实现会员身份伪造、DRM 解密或额外的资源授权。接口拒绝访问、所选音质不可用、地址过期时会显示错误；试听地址保存下来的仍是试听内容。文件头检查仅用于格式识别和常见错误检测，不证明音频一定是完整歌曲，也不等同于 DRM 检测。

“最高可用音质”按接口标记的 Hi-Res、FLAC、320、128 顺序选择；明确指定音质时不自动降档。批量任务顺序执行，普通单曲失败后继续后面的歌曲；接口提示需要账户验证时停止。

## 保存与取消

保存组件使用 Windows .NET Framework，单文件上限 2 GB，流式写入以控制内存占用。正常取消或失败会删除当前任务自己的临时文件，已完成文件保留；强制结束操作系统进程时可能留下 `.part` 文件。

进度经保存组件 → MoeKoe → 插件桥接页 → 播放器面板传递。关闭面板或插件设置弹窗不改变正在执行的主窗口任务；关闭或重载播放器主窗口时会请求取消。

## 代码位置

- [`content.js`](../moekoe-song-downloader/content.js)：界面入口、位置、任务队列。
- [`data.js`](../moekoe-song-downloader/data.js)：歌曲、歌单和音质。
- [`page-bridge.js`](../moekoe-song-downloader/page-bridge.js)：账户上下文中的接口请求。
- [`bridge.js`](../moekoe-song-downloader/bridge.js)：客户端与本地保存组件之间的消息。
- [`SongSaver.cs`](../native/SongSaver.cs)：网络接收和文件保存。
