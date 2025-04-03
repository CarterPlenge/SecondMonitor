const { app, BrowserWindow } = require("electron");
const { execSync } = require("child_process");
const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');
const AutoLaunch = require('auto-launch');

// Create auto launcher with the full path to your app
const autoLauncher = new AutoLaunch({
    name: 'Desktop Calendar',
    path: process.execPath,    // Use process.execPath instead of app.getPath('exe')
    isHidden: true            // Hide the launch process
});

// Enable auto launch
autoLauncher.isEnabled().then((isEnabled) => {
    if (!isEnabled) {
        autoLauncher.enable();
    }
}).catch((err) => {
    console.error('Failed to configure auto-launch:', err);
});

let mainWindow;

app.whenReady().then(async () => {
    // Get all displays
    const displays = require('electron').screen.getAllDisplays();
    
    // Debug log to see display information
    console.log('Available displays:', displays.map(d => ({
        isPrimary: d.isPrimary,
        bounds: d.bounds,
        workArea: d.workArea,
        id: d.id
    })));

    // Find the secondary display (the one with negative x coordinate in this case)
    const targetDisplay = displays.find(display => display.bounds.x < 0) || displays[0];
    
    // Debug log to see which display was selected
    console.log('Selected display:', {
        isPrimary: targetDisplay.isPrimary,
        bounds: targetDisplay.bounds,
        workArea: targetDisplay.workArea,
        id: targetDisplay.id
    });

    mainWindow = new BrowserWindow({
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.workAreaSize.width,
        height: targetDisplay.workAreaSize.height,
        frame: false,
        transparent: true,
        fullscreen: false,
        focusable: false,
        resizable: false,
        alwaysOnTop: false,
        skipTaskbar: true,
        type: 'desktop',
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            partition: 'persist:custom',
        },
    });

    // Prevent scrollbars
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.insertCSS('body { overflow: hidden !important; margin: 0; }');
    });

    mainWindow.setIgnoreMouseEvents(true);
    mainWindow.loadFile("index.html");
    
    if (process.platform === "win32") {
        // Try multiple times to ensure proper attachment
        setTimeout(attachToDesktop, 1000);
        setTimeout(attachToDesktop, 2000);
        setTimeout(attachToDesktop, 5000);
    }

    // Set up calendar and tasks updates
    try {
        const auth = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });
        const tasks = google.tasks({ version: 'v1', auth });
        
        async function updateCalendarAndTasks() {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const endOfDay = new Date(startOfDay);
            endOfDay.setDate(startOfDay.getDate() + 1);

            try {
                // Get calendar events
                const calendarResponse = await calendar.events.list({
                    calendarId: 'primary',
                    timeMin: startOfDay.toISOString(),
                    timeMax: endOfDay.toISOString(),
                    maxResults: 20,
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                // Filter events that are either ongoing or haven't started yet
                const currentEvents = calendarResponse.data.items.filter(event => {
                    const eventEnd = new Date(event.end.dateTime || event.end.date);
                    return eventEnd > now;
                });

                // Get tasks
                const taskResponse = await tasks.tasklists.list();
                const taskLists = taskResponse.data.items;
                let allTasks = [];

                // Get tasks from each task list
                for (const taskList of taskLists) {
                    const taskItems = await tasks.tasks.list({
                        tasklist: taskList.id,
                        showCompleted: false,
                        dueMax: endOfDay.toISOString(),
                    });
                    
                    if (taskItems.data.items) {
                        allTasks = allTasks.concat(taskItems.data.items);
                    }
                }

                // Filter tasks due today or overdue
                const currentTasks = allTasks.filter(task => {
                    if (!task.due) return false;
                    const dueDate = new Date(task.due);
                    return dueDate <= endOfDay;
                });

                // Send both events and tasks to the renderer
                mainWindow.webContents.send('calendar-update', {
                    events: currentEvents,
                    tasks: currentTasks
                });
            } catch (err) {
                console.error('Error fetching calendar events or tasks:', err);
            }
        }

        // Update every minute
        updateCalendarAndTasks();
        setInterval(updateCalendarAndTasks, 60 * 1000);
    } catch (err) {
        console.error('Error setting up calendar and tasks:', err);
    }

    // Add this line after window creation
    app.commandLine.appendSwitch('disable-gpu-cache');
});

function attachToDesktop() {
    try {
        execSync(
            `powershell -command "
            $HWND = (Get-Process -Id $PID).MainWindowHandle;
            Add-Type -TypeDefinition @'
            using System;
            using System.Runtime.InteropServices;
            public class Win32 {
                [DllImport(\\"user32.dll\\")]
                public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
                [DllImport(\\"user32.dll\\")]
                public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
                [DllImport(\\"user32.dll\\")]
                public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
                [DllImport(\\"user32.dll\\")]
                public static extern int SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
                [DllImport(\\"user32.dll\\")]
                public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
                [DllImport(\\"user32.dll\\")]
                public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
            }
            '@ -Language CSharp -PassThru;

            $HWND_BOTTOM = [IntPtr]::new(1);
            $SWP_NOMOVE = 0x0002;
            $SWP_NOSIZE = 0x0001;
            $SWP_NOACTIVATE = 0x0010;
            $SW_HIDE = 0;
            $SW_SHOW = 5;

            $Progman = [Win32]::FindWindow('Progman', $null);
            [IntPtr]$result = [IntPtr]::Zero;
            [Win32]::SendMessageTimeout($Progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0x0, 1000, [ref]$result);
            
            $WorkerW = [IntPtr]::Zero;
            do {
                $WorkerW = [Win32]::FindWindowEx([IntPtr]::Zero, $WorkerW, 'WorkerW', $null);
                $DefView = [Win32]::FindWindowEx($WorkerW, [IntPtr]::Zero, 'SHELLDLL_DefView', $null);
                if ($DefView -ne [IntPtr]::Zero) {
                    break;
                }
            } while ($WorkerW -ne [IntPtr]::Zero);

            # Try to force the window to the bottom
            [Win32]::ShowWindow($HWND, $SW_HIDE);
            [Win32]::SetWindowPos($HWND, $HWND_BOTTOM, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE);
            [Win32]::SetParent($HWND, $WorkerW);
            [Win32]::ShowWindow($HWND, $SW_SHOW);
            [Win32]::SetWindowPos($HWND, $HWND_BOTTOM, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE);
        "`
        );
    } catch (error) {
        console.error("Failed to attach window to desktop:", error);
    }
}
