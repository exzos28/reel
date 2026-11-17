using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Tizen.Applications;

namespace ReelCore
{
    // The reel core's host process on the TV. The TV app (ui/) launches it with an AppControl
    // carrying a fresh token:
    //
    //   operation default, extra data  command=start, token=<32 hex chars>
    //       → loads lib/libreel_tizen_core.so and starts it on 127.0.0.1:47391 (first launch),
    //         or hands the running core the new token. The core also serves the web app's
    //         NSH build (res/wgt/web/ of this package) under /ui/.
    //   command=stop  → exits
    //
    // All the work happens in the Rust library's own threads; this class only keeps the
    // process (a Tizen service app) alive. The core's log goes to data/core.log.
    class App : ServiceApplication
    {
        const ushort Port = 47391;   // reel_tizen_core::DEFAULT_PORT; ui/shell.js uses the same
        const string Library = "libreel_tizen_core.so";

        [DllImport(Library)] static extern int reel_core_start(ushort port, string token, string dataDir, string cacheDir, string uiDir, string logPath);
        [DllImport(Library)] static extern int reel_core_set_token(string token);
        [DllImport(Library)] static extern UIntPtr reel_core_last_error(byte[] buf, UIntPtr len);

        static string LastError()
        {
            var buf = new byte[1024];
            reel_core_last_error(buf, (UIntPtr)buf.Length);
            int n = Array.IndexOf(buf, (byte)0);
            return Encoding.UTF8.GetString(buf, 0, n < 0 ? buf.Length : n);
        }

        // DllImport would search the default paths; the library ships in the package's lib/.
        static IntPtr Resolve(string name, Assembly assembly, DllImportSearchPath? path)
        {
            if (name != Library) return IntPtr.Zero;
            // Tizen's DirectoryInfo has no lib folder: the package root is res/'s parent.
            var root = Path.GetDirectoryName(Current.DirectoryInfo.Resource.TrimEnd('/'));
            return NativeLibrary.Load(Path.Combine(root, "lib", Library));
        }

        protected override void OnCreate()
        {
            base.OnCreate();
            NativeLibrary.SetDllImportResolver(typeof(App).Assembly, Resolve);
        }

        protected override void OnAppControlReceived(AppControlReceivedEventArgs e)
        {
            base.OnAppControlReceived(e);
            var extra = e.ReceivedAppControl.ExtraData;
            string command = null, token = null;
            try { extra.TryGet("command", out command); } catch { }
            try { extra.TryGet("token", out token); } catch { }

            if (command == "stop") { Exit(); return; }
            if (command != "start" || string.IsNullOrEmpty(token))
            {
                Console.Error.WriteLine($"[ReelCore] ignored AppControl command={command ?? "null"}");
                return;
            }

            string data = Current.DirectoryInfo.Data;
            string cache = Current.DirectoryInfo.Cache;
            // A hybrid package keeps the web app's files in res/wgt/ of the shared package
            // directory; ../build.sh puts the NSH build in web/ there. GET /health reports
            // whether index.html was found (info.ui.index).
            string ui = Path.Combine(Current.DirectoryInfo.Resource, "wgt", "web");
            int code;
            try
            {
                code = reel_core_start(Port, token, data, cache, ui, Path.Combine(data, "core.log"));
            }
            catch (Exception ex)
            {
                // Library missing or not loadable (wrong ABI, missing glibc symbols): the TV app
                // sees no /health and shows that the core did not start.
                Console.Error.WriteLine($"[ReelCore] loading {Library}: {ex}");
                WriteStartupError(data, ex.ToString());
                return;
            }
            if (code < 0)
            {
                string error = LastError();
                Console.Error.WriteLine($"[ReelCore] start failed ({code}): {error}");
                WriteStartupError(data, $"start failed ({code}): {error}");
            }
        }

        // Kept next to core.log so the reason is readable over sdb shell on a rooted TV.
        static void WriteStartupError(string dataDir, string text)
        {
            try { File.WriteAllText(Path.Combine(dataDir, "startup-error.txt"), $"{DateTime.UtcNow:o} {text}\n"); }
            catch { }
        }

        static void Main(string[] args)
        {
            new App().Run(args);
        }
    }
}
