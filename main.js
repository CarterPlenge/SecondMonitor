const { app, BrowserWindow } = require("electron");
const { execSync } = require("child_process");

let mainWindow;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        frame: false,
        transparent: true,
        fullscreen: true,
        focusable: false,
        resizable: false,
        alwaysOnTop: false,
        webPreferences: {
            nodeIntegration: false,
        },
    });

    mainWindow.setIgnoreMouseEvents(true); // Makes it click-through
    mainWindow.loadFile("index.html");

    if (process.platform === "win32") {
        setTimeout(attachToDesktop, 1000); // Ensure Explorer is loaded
    }
});

function attachToDesktop() {
    try {
        execSync(
            `powershell -command "
            $HWND = (Get-Process -Id $PID).MainWindowHandle;
            $Shell = (Get-Process explorer).MainWindowHandle;
            Add-Type -TypeDefinition @'
            using System;
            using System.Runtime.InteropServices;
            public class Win32 {
                [DllImport(\\"user32.dll\\")]
                public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
                [DllImport(\\"user32.dll\\")]
                public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
                [DllImport(\\"user32.dll\\")]
                public static extern int ShowWindow(IntPtr hWnd, int nCmdShow);
                public const int SW_HIDE = 0;
                public const int SW_SHOW = 5;
            }
            '@ -Language CSharp -PassThru;
            $Progman = [Win32]::FindWindow('Progman', $null);
            $WorkerW = 0;
            [Win32]::ShowWindow($Progman, [Win32]::SW_HIDE);
            Start-Sleep -Milliseconds 500;
            $Windows = @(Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.MainWindowHandle });
            foreach ($Win in $Windows) {
                if ($Win -ne $Progman -and $Win -ne $Shell) {
                    $WorkerW = $Win;
                    break;
                }
            }
            if ($WorkerW -ne 0) {
                [Win32]::SetParent($HWND, $WorkerW);
            }
        "`
        );
    } catch (error) {
        console.error("Failed to attach window to desktop:", error);
    }
}
