using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Web.Script.Serialization;

// JSON Lines transport used by MoeKoe's managed native-host API. No listening port or shell.
internal static class SongSaver {
    static readonly object OutputLock = new object();
    static readonly ConcurrentDictionary<string, CancellationTokenSource> Jobs = new ConcurrentDictionary<string, CancellationTokenSource>();
    static readonly StreamWriter Output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
    static string Text(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? Convert.ToString(value) : ""; }
    static void Send(object data) { lock (OutputLock) { Output.WriteLine(new JavaScriptSerializer().Serialize(data)); } }
    static void Result(string id, string kind, object data) { Send(new { id = id, kind = kind, data = data }); }

    [STAThread]
    static void Main() {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        ServicePointManager.DefaultConnectionLimit = 8;
        using (var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))) {
            string line;
            while ((line = input.ReadLine()) != null) {
                if (line.Length > 65536) continue;
                try {
                    var envelope = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line);
                    if (Text(envelope, "type") == "shutdown") break;
                    object raw;
                    if (Text(envelope, "type") != "message" || !envelope.TryGetValue("payload", out raw)) continue;
                    var request = raw as Dictionary<string, object>;
                    if (request == null) continue;
                    string id = Text(request, "id"), action = Text(request, "action");
                    if (id.Length == 0 || id.Length > 128) continue;
                    if (action == "ping") { Result(id, "complete", new { ready = true }); continue; }
                    if (action == "cancel") {
                        CancellationTokenSource target;
                        if (Jobs.TryGetValue(Text(request, "jobId"), out target)) target.Cancel();
                        Result(id, "complete", new { cancelled = true });
                        continue;
                    }
                    if (action != "download") { Result(id, "error", new { message = "未知操作。" }); continue; }
                    var cancellation = new CancellationTokenSource();
                    if (!Jobs.TryAdd(id, cancellation)) { cancellation.Dispose(); Result(id, "error", new { message = "任务编号重复。" }); continue; }
                    Task.Run(() => Download(request, cancellation));
                } catch { /* Invalid envelopes must not terminate an active download. */ }
            }
        }
        foreach (var job in Jobs.Values) job.Cancel();
        for (int i = 0; i < 30 && Jobs.Count > 0; i++) Thread.Sleep(50);
    }

    static string SafeName(string value) {
        var result = new StringBuilder();
        foreach (char c in value) result.Append(c < 32 || "<>:\"/\\|?*".IndexOf(c) >= 0 ? '_' : c);
        string text = result.ToString().Trim().Trim('.');
        if (text.Length > 150) text = text.Substring(0, 150).TrimEnd('.');
        if (String.IsNullOrWhiteSpace(text)) text = "未命名歌曲";
        if (System.Text.RegularExpressions.Regex.IsMatch(text, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) text = "_" + text;
        return text;
    }
    static bool Match(byte[] bytes, int length, string text, int offset) {
        if (length < offset + text.Length) return false;
        for (int i = 0; i < text.Length; i++) if (bytes[offset + i] != (byte)text[i]) return false;
        return true;
    }
    static string Format(byte[] bytes, int length) {
        if (Match(bytes, length, "fLaC", 0)) return "flac";
        if (Match(bytes, length, "RIFF", 0) && Match(bytes, length, "WAVE", 8)) return "wav";
        if (Match(bytes, length, "OggS", 0)) return Encoding.ASCII.GetString(bytes, 0, length).Contains("OpusHead") ? "opus" : "ogg";
        if (Match(bytes, length, "ftyp", 4)) return "m4a";
        if (Match(bytes, length, "MAC ", 0)) return "ape";
        if (Match(bytes, length, "wvpk", 0)) return "wv";
        if (Match(bytes, length, "ID3", 0)) return "mp3";
        if (length >= 4 && bytes[0] == 255) {
            if ((bytes[1] & 0xf6) == 0xf0) return "aac";
            int bitrate = bytes[2] >> 4;
            if ((bytes[1] & 0xe0) == 0xe0 && ((bytes[1] >> 3) & 3) != 1 && ((bytes[1] >> 1) & 3) != 0 && bitrate > 0 && bitrate < 15 && ((bytes[2] >> 2) & 3) != 3) return "mp3";
        }
        throw new IOException("音源没有返回有效音频文件，可能是链接失效或该音质不可用。");
    }

    static void Download(Dictionary<string, object> data, CancellationTokenSource cancellation) {
        string id = Text(data, "id"), temp = null;
        HttpWebRequest request = null;
        try {
            Uri url;
            if (!Uri.TryCreate(Text(data, "url"), UriKind.Absolute, out url) || (url.Scheme != "https" && url.Scheme != "http") || !String.IsNullOrEmpty(url.UserInfo)) throw new IOException("无效的音频地址。");
            string selected = Text(data, "folder");
            if (!Path.IsPathRooted(selected) || !Directory.Exists(selected)) throw new IOException("所选保存文件夹不存在，请重新选择。");
            string folder = Path.GetFullPath(selected);
            string subfolder = Text(data, "subfolder");
            if (!String.IsNullOrEmpty(subfolder)) {
                string child = Path.GetFullPath(Path.Combine(folder, SafeName(subfolder)));
                if (!child.StartsWith(folder.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("无效的歌单文件夹。");
                Directory.CreateDirectory(child); folder = child;
            }
            string stem = SafeName(Text(data, "stem"));
            request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = 30000; request.ReadWriteTimeout = 30000;
            request.AllowAutoRedirect = true; request.MaximumAutomaticRedirections = 6;
            request.UserAgent = "Mozilla/5.0 MoeKoeSongDownloader/0.2.0";
            // No account token or cookie is sent to the audio CDN.
            using (cancellation.Token.Register(() => { try { request.Abort(); } catch {} }))
            using (var response = (HttpWebResponse)request.GetResponse()) {
                if (response.StatusCode == HttpStatusCode.PartialContent) {
                    var range = System.Text.RegularExpressions.Regex.Match(response.Headers["Content-Range"] ?? "", @"^bytes 0-(\d+)/(\d+)$");
                    if (!range.Success || Int64.Parse(range.Groups[1].Value) + 1 != Int64.Parse(range.Groups[2].Value)) throw new IOException("服务器只返回了部分音频，文件未保存。");
                }
                long total = response.ContentLength, received = 0;
                const long limit = 2L * 1024 * 1024 * 1024;
                if (total > limit) throw new IOException("音频超过 2 GB，已停止下载。");
                temp = Path.Combine(folder, ".mkd-" + Guid.NewGuid().ToString("N") + ".part");
                var header = new byte[256]; int headerLength = 0;
                using (var stream = response.GetResponseStream())
                using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536)) {
                    var buffer = new byte[65536]; int count;
                    var last = DateTime.MinValue;
                    while ((count = stream.Read(buffer, 0, buffer.Length)) > 0) {
                        cancellation.Token.ThrowIfCancellationRequested();
                        received += count;
                        if (received > limit) throw new IOException("音频超过 2 GB，已停止下载。");
                        int copy = Math.Min(count, header.Length - headerLength);
                        if (copy > 0) { Buffer.BlockCopy(buffer, 0, header, headerLength, copy); headerLength += copy; }
                        file.Write(buffer, 0, count);
                        if ((DateTime.UtcNow - last).TotalMilliseconds >= 180) {
                            last = DateTime.UtcNow; Result(id, "progress", new { received = received, total = Math.Max(total, 0) });
                        }
                    }
                    file.Flush(true);
                }
                cancellation.Token.ThrowIfCancellationRequested();
                if (received == 0) throw new IOException("服务器返回了空文件。");
                if (total >= 0 && received != total) throw new IOException("音频接收不完整，文件未保存。");
                string format = Format(header, headerLength);
                string destination = null;
                for (int index = 0; index < 10000; index++) {
                    cancellation.Token.ThrowIfCancellationRequested();
                    destination = Path.Combine(folder, stem + (index == 0 ? "" : " (" + index + ")") + "." + format);
                    try { File.Move(temp, destination); temp = null; break; }
                    catch (IOException) { if (!File.Exists(destination)) throw; }
                }
                if (temp != null) throw new IOException("同名文件过多，请更换保存文件夹。");
                Result(id, "complete", new { filePath = destination, bytes = received, format = format });
            }
        } catch (Exception error) {
            if (temp != null) { try { File.Delete(temp); } catch {} }
            if (cancellation.IsCancellationRequested) Result(id, "cancelled", new { message = "已取消下载。" });
            else {
                var web = error as WebException;
                var response = web == null ? null : web.Response as HttpWebResponse;
                string message = response == null ? error.Message : "音频下载失败（HTTP " + (int)response.StatusCode + "），请重试或更换音质。";
                if (response != null) response.Dispose();
                Result(id, "error", new { message = message });
            }
        } finally {
            CancellationTokenSource removed;
            Jobs.TryRemove(id, out removed);
            // Do not dispose while the stdin thread may be delivering a cancel command.
        }
    }
}
