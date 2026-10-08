/*
 * «مربع چت» for Windows — the studio's chat as a real desktop app, in the spirit of Telegram Desktop.
 *
 * - One file, no installer: the first run (e.g. from Downloads) copies itself to %LOCALAPPDATA%\MorabaChat,
 *   adds «مربع چت» to the Start menu and the desktop, turns on «start with Windows», and runs from there.
 * - Its own window with the chat inside (Microsoft WebView2, part of Windows 10/11): dark title bar, size and
 *   place remembered, no browser menus or keys. Without WebView2 it falls back to an Edge app window.
 * - Closing keeps it beside the clock (tray), like Telegram; the tray menu has open, Do not disturb,
 *   notifications, start with Windows, settings and exit.
 * - Unread messages: a number on the taskbar button, a dot on the tray icon, «(3) مربع چت» in the title.
 * - New messages while the window is hidden or in the background: a Windows notification (click = that chat),
 *   the taskbar button flashes. Do not disturb: an hour, eight hours, until tomorrow.
 * - Ctrl+Shift+M anywhere shows or hides it. The taskbar jump list: saved messages, quick switch, panel, exit.
 * - Only one copy runs; starting it again brings the window forward. Updates itself from the site.
 * - The site's address is written into the file when it is downloaded from the panel (PHP replaces the
 *   placeholder below), so one build serves every site. A "site.txt" beside the program wins over it.
 *
 * The page side is assets/js/chat-desktop.js (window.__MP_DESKTOP, chrome.webview messages).
 * Build: apps/windows/build.sh (mingw-w64 + the WebView2 SDK it fetches) → assets/app/MorabaChat.exe
 */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <objbase.h>
#include <propkey.h>
#include <dwmapi.h>
#include <urlmon.h>
#include <wchar.h>
#ifndef DECLSPEC_XFGVIRT
#define DECLSPEC_XFGVIRT(a, b)
#endif
#include "WebView2.h"

#define APP_VERSION L"2.0.0"
#define APP_ID L"Moraba.Chat"
#define APP_NAME L"\x0645\x0631\x0628\x0639 \x0686\x062A" /* مربع چت */
#define WND_CLASS L"MorabaChatWnd"
#define REG_KEY L"Software\\MorabaChat"
#define RUN_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Run"

/* Replaced in the downloaded file by the site's chat address (UTF-16LE, the rest of the 300 characters NUL). */
static volatile const wchar_t SITE_URL[300] = L"@@MORABA_CHAT_URL@@";

enum { WM_TRAY = WM_APP + 1, WM_UPDATED, WM_HOSTMSG };
enum { T_TICK = 1, T_RETRY, T_UPDATE };
enum { ID_OPEN = 100, ID_DND_1H, ID_DND_8H, ID_DND_TOMORROW, ID_DND_OFF, ID_NOTIFY, ID_AUTOSTART, ID_SETTINGS, ID_RESTART, ID_EXIT };

static HINSTANCE g_inst;
static HWND g_wnd;
static HICON g_icon, g_icon_sm;
static wchar_t g_home[MAX_PATH], g_self[MAX_PATH], g_url[1100], g_origin[300], g_scope[600];
static ICoreWebView2Environment *g_env;
static ICoreWebView2Controller *g_ctl;
static ICoreWebView2 *g_web;
static ITaskbarList3 *g_taskbar;
static UINT g_taskbar_msg;
static NOTIFYICONDATAW g_nid;
static int g_unread = -1, g_focused, g_quitting, g_updated, g_last_channel, g_loaded;
static ULONGLONG g_dnd_until; /* GetTickCount64 */
static wchar_t g_new_version[32];

/* ------------------------------------------------------------------ small helpers */

/** A string PROPVARIANT (mingw's propvarutil.h has no InitPropVariantFromString for C). */
static HRESULT pv_string(const wchar_t *s, PROPVARIANT *pv) {
    size_t bytes = (wcslen(s) + 1) * sizeof(wchar_t);
    PropVariantInit(pv);
    pv->pwszVal = (LPWSTR)CoTaskMemAlloc(bytes);
    if (!pv->pwszVal) return E_OUTOFMEMORY;
    memcpy(pv->pwszVal, s, bytes);
    pv->vt = VT_LPWSTR;
    return S_OK;
}

static void dir_of(wchar_t *path) { wchar_t *s = wcsrchr(path, L'\\'); if (s) *s = 0; }
static int exists(const wchar_t *p) { return GetFileAttributesW(p) != INVALID_FILE_ATTRIBUTES; }

static DWORD reg_get(const wchar_t *name, DWORD def) {
    DWORD v = def, sz = sizeof(v);
    if (RegGetValueW(HKEY_CURRENT_USER, REG_KEY, name, RRF_RT_REG_DWORD, NULL, &v, &sz) != ERROR_SUCCESS) return def;
    return v;
}
static void reg_set(const wchar_t *name, DWORD v) {
    HKEY k;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, REG_KEY, 0, NULL, 0, KEY_SET_VALUE, NULL, &k, NULL) == ERROR_SUCCESS) {
        RegSetValueExW(k, name, 0, REG_DWORD, (const BYTE *)&v, sizeof(v));
        RegCloseKey(k);
    }
}

/** «start with Windows»: the Run key points at the installed copy, starting quietly beside the clock. */
static void set_autostart(int on) {
    HKEY k;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, RUN_KEY, 0, KEY_SET_VALUE, &k) != ERROR_SUCCESS) return;
    if (on) {
        wchar_t cmd[MAX_PATH + 32];
        swprintf(cmd, MAX_PATH + 32, L"\"%ls\\MorabaChat.exe\" --tray", g_home);
        RegSetValueExW(k, L"MorabaChat", 0, REG_SZ, (const BYTE *)cmd, (DWORD)((wcslen(cmd) + 1) * sizeof(wchar_t)));
    } else RegDeleteValueW(k, L"MorabaChat");
    RegCloseKey(k);
    reg_set(L"autostart", on ? 1 : 0);
}

/** The chat's address: site.txt beside the program, else the one written in at download. */
static void read_url(void) {
    wchar_t txt[MAX_PATH];
    g_url[0] = 0;
    swprintf(txt, MAX_PATH, L"%ls\\site.txt", g_home);
    HANDLE f = CreateFileW(txt, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f != INVALID_HANDLE_VALUE) {
        char buf[1024]; DWORD got = 0;
        if (ReadFile(f, buf, sizeof(buf) - 1, &got, NULL) && got > 0) {
            buf[got] = 0;
            char *e = buf + strlen(buf);
            while (e > buf && (e[-1] == '\r' || e[-1] == '\n' || e[-1] == ' ')) *--e = 0;
            MultiByteToWideChar(CP_UTF8, 0, buf, -1, g_url, 1100);
        }
        CloseHandle(f);
    }
    if (!g_url[0] || wcsncmp(g_url, L"http", 4) != 0) {
        size_t i = 0;
        for (; i < 299 && SITE_URL[i]; i++) g_url[i] = SITE_URL[i];
        g_url[i] = 0;
    }
    /* origin (scheme://host[:port]) and the chat's own path, for keeping links in or out of the window */
    const wchar_t *p = wcsstr(g_url, L"://");
    if (p) {
        const wchar_t *slash = wcschr(p + 3, L'/');
        size_t n = slash ? (size_t)(slash - g_url) : wcslen(g_url);
        if (n >= 300) n = 299;
        wcsncpy(g_origin, g_url, n); g_origin[n] = 0;
        wcsncpy(g_scope, slash ? slash : L"/", 599); g_scope[599] = 0;
        wchar_t *q = wcschr(g_scope, L'?'); if (q) *q = 0;
    }
}

static void post_json(const wchar_t *json) { if (g_web) ICoreWebView2_PostWebMessageAsJson(g_web, json); }

/* tiny JSON readers for the page's flat messages ({"t":"notify","title":"…","channel":3}) */
static const wchar_t *json_find(const wchar_t *j, const wchar_t *key) {
    wchar_t pat[40];
    swprintf(pat, 40, L"\"%ls\":", key);
    const wchar_t *p = wcsstr(j, pat);
    if (!p) return NULL;
    p += wcslen(pat);
    while (*p == L' ') p++;
    return p;
}
static long json_num(const wchar_t *j, const wchar_t *key, long def) {
    const wchar_t *p = json_find(j, key);
    return p ? wcstol(p, NULL, 10) : def;
}
static void json_str(const wchar_t *j, const wchar_t *key, wchar_t *out, size_t n) {
    const wchar_t *p = json_find(j, key);
    size_t i = 0;
    out[0] = 0;
    if (!p || *p != L'"') return;
    for (p++; *p && *p != L'"' && i + 1 < n; p++) {
        if (*p == L'\\' && p[1]) {
            p++;
            if (*p == L'n') out[i++] = L' ';
            else if (*p == L'u' && p[1] && p[2] && p[3] && p[4]) { wchar_t h[5] = { p[1], p[2], p[3], p[4], 0 }; out[i++] = (wchar_t)wcstol(h, NULL, 16); p += 4; }
            else out[i++] = *p;
        } else out[i++] = *p;
    }
    out[i] = 0;
}

/* ------------------------------------------------------------------ icons: the unread number and dot */

static HICON make_icon(int size, int n, int dot) {
    BITMAPV5HEADER bi = { 0 };
    bi.bV5Size = sizeof(bi); bi.bV5Width = size; bi.bV5Height = -size; bi.bV5Planes = 1; bi.bV5BitCount = 32;
    bi.bV5Compression = BI_BITFIELDS; bi.bV5RedMask = 0x00FF0000; bi.bV5GreenMask = 0x0000FF00; bi.bV5BlueMask = 0x000000FF; bi.bV5AlphaMask = 0xFF000000;
    void *bits = NULL;
    HDC screen = GetDC(NULL), dc = CreateCompatibleDC(screen);
    HBITMAP color = CreateDIBSection(screen, (BITMAPINFO *)&bi, DIB_RGB_COLORS, &bits, NULL, 0);
    ReleaseDC(NULL, screen);
    HGDIOBJ old = SelectObject(dc, color);
    DWORD *px = (DWORD *)bits;
    memset(bits, 0, (size_t)size * size * 4);
    if (dot) DrawIconEx(dc, 0, 0, g_icon_sm ? g_icon_sm : g_icon, size, size, 0, NULL, DI_NORMAL);
    /* an orange circle: the whole icon (taskbar number) or a dot in the corner (tray) */
    int cx = dot ? size - size / 4 - 1 : size / 2, cy = dot ? size / 4 : size / 2, r = dot ? size / 4 + 1 : size / 2;
    for (int y = 0; y < size; y++)
        for (int x = 0; x < size; x++) {
            int dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
            if (d2 <= r * r) px[y * size + x] = 0xFFF28A24;
            else if (dot && d2 <= (r + 1) * (r + 1)) px[y * size + x] = 0xFF161616;
        }
    if (!dot && n > 0) {
        wchar_t t[8];
        if (n > 99) wcscpy(t, L"99+"); else swprintf(t, 8, L"%d", n);
        HFONT f = CreateFontW(n > 99 ? -size * 4 / 10 : n > 9 ? -size * 55 / 100 : -size * 7 / 10, 0, 0, 0, FW_BOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, ANTIALIASED_QUALITY, 0, L"Segoe UI");
        HGDIOBJ of = SelectObject(dc, f);
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, RGB(255, 255, 255));
        RECT rc = { 0, 0, size, size };
        DrawTextW(dc, t, -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        SelectObject(dc, of); DeleteObject(f);
        /* GDI text leaves alpha at 0: make the white pixels opaque again */
        for (int i = 0; i < size * size; i++) if ((px[i] & 0xFF000000) == 0 && (px[i] & 0x00FFFFFF)) px[i] |= 0xFF000000;
    }
    SelectObject(dc, old);
    DeleteDC(dc);
    HBITMAP mask = CreateBitmap(size, size, 1, 1, NULL);
    ICONINFO ii = { TRUE, 0, 0, mask, color };
    HICON ic = CreateIconIndirect(&ii);
    DeleteObject(mask); DeleteObject(color);
    return ic;
}

static int dnd(void) { return g_dnd_until && GetTickCount64() < g_dnd_until; }

static void tray_tip(void) {
    if (g_unread > 0) swprintf(g_nid.szTip, 128, L"%ls \x2014 %d \x067E\x06CC\x0627\x0645 \x0646\x062E\x0648\x0627\x0646\x062F\x0647%ls", APP_NAME, g_unread, dnd() ? L" (\x0645\x0632\x0627\x062D\x0645 \x0646\x0634\x0648)" : L"");
    else swprintf(g_nid.szTip, 128, L"%ls%ls", APP_NAME, dnd() ? L" (\x0645\x0632\x0627\x062D\x0645 \x0646\x0634\x0648)" : L"");
}

static void set_unread(int n) {
    if (n < 0) n = 0;
    if (n == g_unread) return;
    g_unread = n;
    /* taskbar number */
    if (g_taskbar) {
        HICON ov = n ? make_icon(32, n, 0) : NULL;
        ITaskbarList3_SetOverlayIcon(g_taskbar, g_wnd, ov, n ? L"\x067E\x06CC\x0627\x0645 \x0646\x062E\x0648\x0627\x0646\x062F\x0647" : NULL);
        if (ov) DestroyIcon(ov);
    }
    /* tray dot + tooltip */
    static HICON dotted;
    if (dotted) { DestroyIcon(dotted); dotted = NULL; }
    if (n) dotted = make_icon(GetSystemMetrics(SM_CXSMICON), 0, 1);
    g_nid.hIcon = n && dotted ? dotted : g_icon_sm;
    g_nid.uFlags = NIF_ICON | NIF_TIP | NIF_SHOWTIP;
    tray_tip();
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
    /* «(3) مربع چت» */
    wchar_t t[80];
    if (n) swprintf(t, 80, L"(%d) %ls", n, APP_NAME); else wcscpy(t, APP_NAME);
    SetWindowTextW(g_wnd, t);
}

/** A Windows notification from the tray icon (clicking it opens that chat). */
static void notify(const wchar_t *title, const wchar_t *body, int channel) {
    if (!reg_get(L"notify", 1) || dnd()) return;
    g_last_channel = channel;
    g_nid.uFlags = NIF_INFO | NIF_SHOWTIP;
    lstrcpynW(g_nid.szInfoTitle, title && *title ? title : APP_NAME, 64);
    lstrcpynW(g_nid.szInfo, reg_get(L"preview", 1) && body && *body ? body : L"\x067E\x06CC\x0627\x0645 \x062A\x0627\x0632\x0647", 256);
    g_nid.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON | NIIF_RESPECT_QUIET_TIME | (reg_get(L"sound", 1) ? 0 : NIIF_NOSOUND);
    g_nid.hBalloonIcon = g_icon;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
    if (GetForegroundWindow() != g_wnd) {
        FLASHWINFO fw = { sizeof(fw), g_wnd, FLASHW_TRAY | FLASHW_TIMERNOFG, 0, 0 };
        FlashWindowEx(&fw);
    }
}

/* ------------------------------------------------------------------ window show / hide */

static void set_visible(int on) { if (g_ctl) ICoreWebView2Controller_put_IsVisible(g_ctl, on ? TRUE : FALSE); }

static void show_window(void) {
    if (IsIconic(g_wnd)) ShowWindow(g_wnd, SW_RESTORE); else ShowWindow(g_wnd, SW_SHOW);
    SetForegroundWindow(g_wnd);
    set_visible(1);
    if (g_ctl) ICoreWebView2Controller_MoveFocus(g_ctl, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    post_json(L"{\"t\":\"shown\"}");
}

static void save_placement(void) {
    WINDOWPLACEMENT wp = { sizeof(wp) };
    HKEY k;
    if (!GetWindowPlacement(g_wnd, &wp)) return;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, REG_KEY, 0, NULL, 0, KEY_SET_VALUE, NULL, &k, NULL) == ERROR_SUCCESS) {
        RegSetValueExW(k, L"placement", 0, REG_BINARY, (const BYTE *)&wp, sizeof(wp));
        RegCloseKey(k);
    }
}

static void hide_window(void) {
    save_placement();
    ShowWindow(g_wnd, SW_HIDE);
    set_visible(0);
    if (!reg_get(L"tray_told", 0)) {
        reg_set(L"tray_told", 1);
        g_last_channel = 0;
        g_nid.uFlags = NIF_INFO | NIF_SHOWTIP;
        lstrcpynW(g_nid.szInfoTitle, APP_NAME, 64);
        lstrcpynW(g_nid.szInfo, L"\x0645\x0631\x0628\x0639 \x0686\x062A \x06A9\x0646\x0627\x0631 \x0633\x0627\x0639\x062A \x0628\x0627\x0632 \x0645\x06CC\x200C\x0645\x0627\x0646\x062F \x062A\x0627 \x067E\x06CC\x0627\x0645\x200C\x0647\x0627 \x0631\x0627 \x0627\x0632 \x062F\x0633\x062A \x0646\x062F\x0647\x06CC\x062F. \x0628\x0631\x0627\x06CC \x062E\x0631\x0648\x062C \x06A9\x0627\x0645\x0644\x060C \x0631\x0648\x06CC \x0622\x06CC\x06A9\x0648\x0646 \x0622\x0646 \x0631\x0627\x0633\x062A\x200C\x06A9\x0644\x06CC\x06A9 \x06A9\x0646\x06CC\x062F.", 256);
        g_nid.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON | NIIF_NOSOUND;
        g_nid.hBalloonIcon = g_icon;
        Shell_NotifyIconW(NIM_MODIFY, &g_nid);
    }
}

static void toggle_window(void) {
    if (IsWindowVisible(g_wnd) && !IsIconic(g_wnd) && GetForegroundWindow() == g_wnd) hide_window();
    else show_window();
}

/* ------------------------------------------------------------------ the tray menu */

static void menu_item(HMENU m, UINT id, const wchar_t *text, int checked, int grayed) {
    MENUITEMINFOW mi = { sizeof(mi) };
    mi.fMask = MIIM_ID | MIIM_STRING | MIIM_FTYPE | MIIM_STATE;
    mi.fType = MFT_STRING | MFT_RIGHTORDER | MFT_RIGHTJUSTIFY;
    mi.fState = (checked ? MFS_CHECKED : 0) | (grayed ? MFS_GRAYED : 0) | (id == ID_OPEN ? MFS_DEFAULT : 0);
    mi.wID = id;
    mi.dwTypeData = (LPWSTR)text;
    InsertMenuItemW(m, GetMenuItemCount(m), TRUE, &mi);
}

static void tray_menu(void) {
    HMENU m = CreatePopupMenu(), d = CreatePopupMenu();
    menu_item(d, ID_DND_1H, L"\x06CC\x06A9 \x0633\x0627\x0639\x062A", 0, 0);
    menu_item(d, ID_DND_8H, L"\x0647\x0634\x062A \x0633\x0627\x0639\x062A", 0, 0);
    menu_item(d, ID_DND_TOMORROW, L"\x062A\x0627 \x0641\x0631\x062F\x0627 \x0635\x0628\x062D", 0, 0);
    menu_item(d, ID_DND_OFF, L"\x062E\x0627\x0645\x0648\x0634", !dnd(), 0);
    menu_item(m, ID_OPEN, L"\x0628\x0627\x0632 \x06A9\x0631\x062F\x0646 \x0645\x0631\x0628\x0639 \x0686\x062A", 0, 0);
    AppendMenuW(m, MF_SEPARATOR, 0, NULL);
    MENUITEMINFOW sub = { sizeof(sub) };
    sub.fMask = MIIM_SUBMENU | MIIM_STRING | MIIM_FTYPE | MIIM_STATE;
    sub.fType = MFT_STRING | MFT_RIGHTORDER | MFT_RIGHTJUSTIFY;
    sub.fState = dnd() ? MFS_CHECKED : 0;
    sub.hSubMenu = d;
    sub.dwTypeData = L"\x0645\x0632\x0627\x062D\x0645 \x0646\x0634\x0648";
    InsertMenuItemW(m, GetMenuItemCount(m), TRUE, &sub);
    menu_item(m, ID_NOTIFY, L"\x0627\x0639\x0644\x0627\x0646 \x067E\x06CC\x0627\x0645\x200C\x0647\x0627", reg_get(L"notify", 1), 0);
    menu_item(m, ID_AUTOSTART, L"\x0627\x062C\x0631\x0627 \x0628\x0627 \x0648\x06CC\x0646\x062F\x0648\x0632", reg_get(L"autostart", 1), 0);
    menu_item(m, ID_SETTINGS, L"\x062A\x0646\x0638\x06CC\x0645\x0627\x062A\x2026", 0, 0);
    if (g_updated) {
        wchar_t t[80];
        swprintf(t, 80, L"\x0646\x0635\x0628 \x0646\x0633\x062E\x0647 %ls \x0648 \x0628\x0627\x0632 \x06A9\x0631\x062F\x0646 \x062F\x0648\x0628\x0627\x0631\x0647", g_new_version);
        menu_item(m, ID_RESTART, t, 0, 0);
    }
    AppendMenuW(m, MF_SEPARATOR, 0, NULL);
    menu_item(m, ID_EXIT, L"\x062E\x0631\x0648\x062C", 0, 0);
    POINT pt;
    GetCursorPos(&pt);
    SetForegroundWindow(g_wnd);
    TrackPopupMenuEx(m, TPM_RIGHTBUTTON | TPM_LAYOUTRTL | TPM_RIGHTALIGN | TPM_BOTTOMALIGN, pt.x, pt.y, g_wnd, NULL);
    PostMessageW(g_wnd, WM_NULL, 0, 0);
    DestroyMenu(m);
}

static void settings_to_page(void) {
    wchar_t j[300];
    swprintf(j, 300, L"{\"t\":\"settings\",\"v\":{\"autostart\":%lu,\"tray\":%lu,\"notify\":%lu,\"sound\":%lu,\"preview\":%lu,\"hotkey\":%lu}}",
        reg_get(L"autostart", 1), reg_get(L"tray", 1), reg_get(L"notify", 1), reg_get(L"sound", 1), reg_get(L"preview", 1), reg_get(L"hotkey", 1));
    post_json(j);
}

static void apply_hotkey(void) {
    UnregisterHotKey(g_wnd, 1);
    if (reg_get(L"hotkey", 1)) RegisterHotKey(g_wnd, 1, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, 'M');
}

/* ------------------------------------------------------------------ the taskbar jump list */

static IShellLinkW *task_link(const wchar_t *args, const wchar_t *title) {
    IShellLinkW *sl = NULL;
    wchar_t exe[MAX_PATH];
    swprintf(exe, MAX_PATH, L"%ls\\MorabaChat.exe", g_home);
    if (FAILED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&sl))) return NULL;
    IShellLinkW_SetPath(sl, exe);
    IShellLinkW_SetArguments(sl, args);
    IShellLinkW_SetIconLocation(sl, exe, 0);
    IPropertyStore *ps = NULL;
    if (SUCCEEDED(IShellLinkW_QueryInterface(sl, &IID_IPropertyStore, (void **)&ps))) {
        PROPVARIANT pv;
        if (SUCCEEDED(pv_string(title, &pv))) {
            IPropertyStore_SetValue(ps, &PKEY_Title, &pv);
            IPropertyStore_Commit(ps);
            PropVariantClear(&pv);
        }
        IPropertyStore_Release(ps);
    }
    return sl;
}

static void jump_list(void) {
    ICustomDestinationList *dl = NULL;
    IObjectCollection *col = NULL;
    IObjectArray *removed = NULL, *arr = NULL;
    UINT max = 0;
    if (FAILED(CoCreateInstance(&CLSID_DestinationList, NULL, CLSCTX_INPROC_SERVER, &IID_ICustomDestinationList, (void **)&dl))) return;
    ICustomDestinationList_SetAppID(dl, APP_ID);
    if (SUCCEEDED(ICustomDestinationList_BeginList(dl, &max, &IID_IObjectArray, (void **)&removed)) &&
        SUCCEEDED(CoCreateInstance(&CLSID_EnumerableObjectCollection, NULL, CLSCTX_INPROC_SERVER, &IID_IObjectCollection, (void **)&col))) {
        const wchar_t *tasks[][2] = {
            { L"--switch", L"\x0631\x0641\x062A\x0646 \x0633\x0631\x06CC\x0639 \x0628\x0647 \x06AF\x0641\x062A\x200C\x0648\x06AF\x0648 (Ctrl+K)" },
            { L"--open=saved", L"\x067E\x06CC\x0627\x0645\x200C\x0647\x0627\x06CC \x0630\x062E\x06CC\x0631\x0647\x200C\x0634\x062F\x0647" },
            { L"--panel", L"\x067E\x0646\x0644 \x0645\x0631\x0628\x0639" },
            { L"--quit", L"\x062E\x0631\x0648\x062C \x0627\x0632 \x0645\x0631\x0628\x0639 \x0686\x062A" },
        };
        for (int i = 0; i < 4; i++) {
            IShellLinkW *sl = task_link(tasks[i][0], tasks[i][1]);
            if (sl) { IObjectCollection_AddObject(col, (IUnknown *)sl); IShellLinkW_Release(sl); }
        }
        if (SUCCEEDED(IObjectCollection_QueryInterface(col, &IID_IObjectArray, (void **)&arr))) {
            ICustomDestinationList_AddUserTasks(dl, arr);
            IObjectArray_Release(arr);
        }
        ICustomDestinationList_CommitList(dl);
    }
    if (col) IObjectCollection_Release(col);
    if (removed) IObjectArray_Release(removed);
    ICustomDestinationList_Release(dl);
}

/* ------------------------------------------------------------------ commands (from the command line or a second copy) */

static void command(const wchar_t *args) {
    if (!args) args = L"";
    if (wcsstr(args, L"--quit")) { g_quitting = 1; if (IsWindowVisible(g_wnd)) save_placement(); DestroyWindow(g_wnd); return; }
    if (wcsstr(args, L"--tray")) return;
    show_window();
    if (wcsstr(args, L"--open=saved")) post_json(L"{\"t\":\"saved\"}");
    else if (wcsstr(args, L"--switch")) post_json(L"{\"t\":\"switch\"}");
    else if (wcsstr(args, L"--panel")) post_json(L"{\"t\":\"panel\"}");
}

/* ------------------------------------------------------------------ WebView2: COM handlers */

typedef struct Handler { void *vtbl; LONG ref; } Handler;
static HRESULT STDMETHODCALLTYPE h_qi(void *self, REFIID riid, void **out) { (void)riid; *out = self; ((Handler *)self)->ref++; return S_OK; }
static ULONG STDMETHODCALLTYPE h_addref(void *self) { return (ULONG)++((Handler *)self)->ref; }
static ULONG STDMETHODCALLTYPE h_release(void *self) { return (ULONG)--((Handler *)self)->ref; /* static objects */ }
typedef struct { void *qi, *addref, *release, *invoke; } HandlerVtbl;
#define HANDLER(name, fn) static HandlerVtbl name##_vtbl = { (void *)h_qi, (void *)h_addref, (void *)h_release, (void *)fn }; static Handler name = { &name##_vtbl, 1 }

static int same_origin(const wchar_t *uri) {
    size_t n = wcslen(g_origin);
    return n && _wcsnicmp(uri, g_origin, n) == 0 && (uri[n] == 0 || uri[n] == L'/' || uri[n] == L'?' || uri[n] == L'#');
}
static const wchar_t *path_of(const wchar_t *uri) { const wchar_t *p = uri + wcslen(g_origin); return *p ? p : L"/"; }

static void open_outside(const wchar_t *uri) { ShellExecuteW(NULL, L"open", uri, NULL, NULL, SW_SHOWNORMAL); }

/* page → host */
static HRESULT STDMETHODCALLTYPE on_message(void *self, ICoreWebView2 *sender, ICoreWebView2WebMessageReceivedEventArgs *args) {
    (void)self; (void)sender;
    LPWSTR j = NULL;
    if (FAILED(ICoreWebView2WebMessageReceivedEventArgs_get_WebMessageAsJson(args, &j)) || !j) return S_OK;
    wchar_t t[24];
    json_str(j, L"t", t, 24);
    if (!wcscmp(t, L"badge")) set_unread((int)json_num(j, L"n", 0));
    else if (!wcscmp(t, L"notify")) {
        wchar_t title[128], body[300];
        json_str(j, L"title", title, 128);
        json_str(j, L"body", body, 300);
        notify(title, body, (int)json_num(j, L"channel", 0));
    } else if (!wcscmp(t, L"set")) {
        wchar_t k[24];
        long v = json_num(j, L"v", 0);
        json_str(j, L"k", k, 24);
        if (!wcscmp(k, L"autostart")) set_autostart(v != 0);
        else if (!wcscmp(k, L"tray") || !wcscmp(k, L"notify") || !wcscmp(k, L"sound") || !wcscmp(k, L"preview") || !wcscmp(k, L"hotkey")) {
            reg_set(k, v ? 1 : 0);
            if (!wcscmp(k, L"hotkey")) apply_hotkey();
        }
    } else if (!wcscmp(t, L"settings?")) settings_to_page();
    else if (!wcscmp(t, L"show")) show_window();
    CoTaskMemFree(j);
    return S_OK;
}
HANDLER(h_message, on_message);

/* window.open / target=_blank: our files download, our chat stays here, everything else opens in the browser */
static HRESULT STDMETHODCALLTYPE on_new_window(void *self, ICoreWebView2 *sender, ICoreWebView2NewWindowRequestedEventArgs *args) {
    (void)self; (void)sender;
    LPWSTR uri = NULL;
    ICoreWebView2NewWindowRequestedEventArgs_put_Handled(args, TRUE);
    if (FAILED(ICoreWebView2NewWindowRequestedEventArgs_get_Uri(args, &uri)) || !uri) return S_OK;
    if (same_origin(uri) && wcsstr(uri, L"mp_file=")) {
        wchar_t dl[2200];
        swprintf(dl, 2200, L"%ls%ls", uri, wcsstr(uri, L"download=") ? L"" : L"&download=1");
        ICoreWebView2_Navigate(g_web, dl); /* an attachment: WebView2 downloads it, the chat stays */
    } else open_outside(uri);
    CoTaskMemFree(uri);
    return S_OK;
}
HANDLER(h_new_window, on_new_window);

/* top-level navigation: the chat, sign-in and sign-out stay here; the panel and other sites go to the browser */
static HRESULT STDMETHODCALLTYPE on_navigating(void *self, ICoreWebView2 *sender, ICoreWebView2NavigationStartingEventArgs *args) {
    (void)self; (void)sender;
    LPWSTR uri = NULL;
    if (FAILED(ICoreWebView2NavigationStartingEventArgs_get_Uri(args, &uri)) || !uri) return S_OK;
    if (!wcsncmp(uri, L"data:", 5) || !wcsncmp(uri, L"about:", 6)) { CoTaskMemFree(uri); return S_OK; }
    if (!same_origin(uri)) {
        ICoreWebView2NavigationStartingEventArgs_put_Cancel(args, TRUE);
        open_outside(uri);
    } else {
        const wchar_t *p = path_of(uri);
        size_t sl = wcslen(g_scope);
        int ours = !_wcsnicmp(p, g_scope, sl) || wcsstr(p, L"wp-login.php") || wcsstr(p, L"mp_file=") || wcsstr(p, L"mp_panel=chat") || wcsstr(p, L"rest_route");
        if (!wcscmp(p, L"/") || (!wcsncmp(p, L"/?", 2) && !wcsstr(p, L"mp_"))) { /* the site's home (after signing out): back to the chat */
            ICoreWebView2NavigationStartingEventArgs_put_Cancel(args, TRUE);
            ICoreWebView2_Navigate(g_web, g_url);
        } else if (!ours) {
            ICoreWebView2NavigationStartingEventArgs_put_Cancel(args, TRUE);
            open_outside(uri);
        }
    }
    CoTaskMemFree(uri);
    return S_OK;
}
HANDLER(h_navigating, on_navigating);

/* no internet / site down: a calm page that retries by itself */
static HRESULT STDMETHODCALLTYPE on_navigated(void *self, ICoreWebView2 *sender, ICoreWebView2NavigationCompletedEventArgs *args) {
    (void)self; (void)sender;
    BOOL ok = TRUE;
    ICoreWebView2NavigationCompletedEventArgs_get_IsSuccess(args, &ok);
    if (ok) { g_loaded = 1; KillTimer(g_wnd, T_RETRY); return S_OK; }
    COREWEBVIEW2_WEB_ERROR_STATUS st = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
    ICoreWebView2NavigationCompletedEventArgs_get_WebErrorStatus(args, &st);
    if (st == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED) return S_OK;
    ICoreWebView2_NavigateToString(g_web,
        L"<!doctype html><html dir=rtl lang=fa><meta charset=utf-8><style>html,body{height:100%;margin:0;background:#161616;color:#eee;font:15px 'Segoe UI',Tahoma,sans-serif;display:grid;place-items:center;text-align:center}"
        L"b{display:block;font-size:19px;margin-bottom:8px}i{display:inline-block;width:26px;height:26px;border:3px solid #444;border-top-color:#f28a24;border-radius:50%;animation:r 1s linear infinite;margin-top:18px}@keyframes r{to{transform:rotate(360deg)}}</style>"
        L"<div><b>\x0627\x062A\x0635\x0627\x0644 \x0628\x0631\x0642\x0631\x0627\x0631 \x0646\x06CC\x0633\x062A</b>\x0647\x0645\x06CC\x0646 \x06A9\x0647 \x0627\x06CC\x0646\x062A\x0631\x0646\x062A \x0648\x0635\x0644 \x0634\x0648\x062F\x060C \x06AF\x0641\x062A\x200C\x0648\x06AF\x0648\x0647\x0627 \x062E\x0648\x062F\x0634\x0627\x0646 \x0628\x0627\x0632 \x0645\x06CC\x200C\x0634\x0648\x0646\x062F.<br><i></i></div></html>");
    SetTimer(g_wnd, T_RETRY, 6000, NULL);
    return S_OK;
}
HANDLER(h_navigated, on_navigated);

/* microphone, camera, notifications, clipboard: allowed for our own site only */
static HRESULT STDMETHODCALLTYPE on_permission(void *self, ICoreWebView2 *sender, ICoreWebView2PermissionRequestedEventArgs *args) {
    (void)self; (void)sender;
    LPWSTR uri = NULL;
    if (SUCCEEDED(ICoreWebView2PermissionRequestedEventArgs_get_Uri(args, &uri)) && uri) {
        if (same_origin(uri)) ICoreWebView2PermissionRequestedEventArgs_put_State(args, COREWEBVIEW2_PERMISSION_STATE_ALLOW);
        CoTaskMemFree(uri);
    }
    return S_OK;
}
HANDLER(h_permission, on_permission);

static void resize_web(void) {
    if (!g_ctl) return;
    RECT rc;
    GetClientRect(g_wnd, &rc);
    ICoreWebView2Controller_put_Bounds(g_ctl, rc);
}

static HRESULT STDMETHODCALLTYPE on_controller(void *self, HRESULT err, ICoreWebView2Controller *ctl) {
    (void)self;
    if (FAILED(err) || !ctl) return S_OK;
    g_ctl = ctl;
    ICoreWebView2Controller_AddRef(g_ctl);
    ICoreWebView2Controller_get_CoreWebView2(g_ctl, &g_web);
    /* the window's colour behind the page: no white flash */
    ICoreWebView2Controller2 *c2 = NULL;
    if (SUCCEEDED(ICoreWebView2Controller_QueryInterface(g_ctl, &IID_ICoreWebView2Controller2, (void **)&c2))) {
        COREWEBVIEW2_COLOR bg = { 255, 0x16, 0x16, 0x16 };
        ICoreWebView2Controller2_put_DefaultBackgroundColor(c2, bg);
        ICoreWebView2Controller2_Release(c2);
    }
    ICoreWebView2Settings *s = NULL;
    if (SUCCEEDED(ICoreWebView2_get_Settings(g_web, &s))) {
        ICoreWebView2Settings_put_AreDevToolsEnabled(s, FALSE);
        ICoreWebView2Settings_put_AreDefaultContextMenusEnabled(s, FALSE); /* the page has its own menus */
        ICoreWebView2Settings_put_IsStatusBarEnabled(s, FALSE);
        ICoreWebView2Settings_put_IsZoomControlEnabled(s, TRUE);
        ICoreWebView2Settings3 *s3 = NULL;
        if (SUCCEEDED(ICoreWebView2Settings_QueryInterface(s, &IID_ICoreWebView2Settings3, (void **)&s3))) {
            ICoreWebView2Settings3_put_AreBrowserAcceleratorKeysEnabled(s3, FALSE); /* no F5, Ctrl+P, browser find… */
            ICoreWebView2Settings3_Release(s3);
        }
        ICoreWebView2Settings_Release(s);
    }
    ICoreWebView2_AddScriptToExecuteOnDocumentCreated(g_web, L"window.__MP_DESKTOP={v:'" APP_VERSION L"',os:'windows'};", NULL);
    EventRegistrationToken tok;
    ICoreWebView2_add_WebMessageReceived(g_web, (ICoreWebView2WebMessageReceivedEventHandler *)&h_message, &tok);
    ICoreWebView2_add_NewWindowRequested(g_web, (ICoreWebView2NewWindowRequestedEventHandler *)&h_new_window, &tok);
    ICoreWebView2_add_NavigationStarting(g_web, (ICoreWebView2NavigationStartingEventHandler *)&h_navigating, &tok);
    ICoreWebView2_add_NavigationCompleted(g_web, (ICoreWebView2NavigationCompletedEventHandler *)&h_navigated, &tok);
    ICoreWebView2_add_PermissionRequested(g_web, (ICoreWebView2PermissionRequestedEventHandler *)&h_permission, &tok);
    resize_web();
    set_visible(IsWindowVisible(g_wnd) && !IsIconic(g_wnd));
    ICoreWebView2_Navigate(g_web, g_url);
    SetTimer(g_wnd, T_TICK, 15000, NULL);
    return S_OK;
}
HANDLER(h_controller, on_controller);

static HRESULT STDMETHODCALLTYPE on_environment(void *self, HRESULT err, ICoreWebView2Environment *env) {
    (void)self;
    if (FAILED(err) || !env) return S_OK;
    g_env = env;
    ICoreWebView2Environment_AddRef(g_env);
    ICoreWebView2Environment_CreateCoreWebView2Controller(g_env, g_wnd, (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *)&h_controller);
    return S_OK;
}
HANDLER(h_environment, on_environment);

/** WebView2Loader.dll travels inside the program (resource 2) and is written beside it on first need. */
typedef HRESULT (STDAPICALLTYPE *CreateEnvFn)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
static int start_webview(void) {
    wchar_t dll[MAX_PATH], data[MAX_PATH];
    swprintf(dll, MAX_PATH, L"%ls\\WebView2Loader.dll", g_home);
    HRSRC r = FindResourceW(g_inst, MAKEINTRESOURCEW(2), (LPCWSTR)RT_RCDATA);
    if (r) {
        DWORD size = SizeofResource(g_inst, r);
        const void *bytes = LockResource(LoadResource(g_inst, r));
        WIN32_FILE_ATTRIBUTE_DATA fa;
        if (bytes && (!GetFileAttributesExW(dll, GetFileExInfoStandard, &fa) || fa.nFileSizeLow != size)) {
            HANDLE f = CreateFileW(dll, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
            if (f != INVALID_HANDLE_VALUE) { DWORD w; WriteFile(f, bytes, size, &w, NULL); CloseHandle(f); }
        }
    }
    HMODULE m = LoadLibraryW(dll);
    if (!m) return 0;
    CreateEnvFn create = (CreateEnvFn)(void *)GetProcAddress(m, "CreateCoreWebView2EnvironmentWithOptions");
    if (!create) return 0;
    swprintf(data, MAX_PATH, L"%ls\\WebView2", g_home);
    return SUCCEEDED(create(NULL, data, NULL, (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *)&h_environment));
}

/* ------------------------------------------------------------------ updates from the site */

static int newer(const wchar_t *a, const wchar_t *b) { /* is a > b ("2.1.0" > "2.0.9") */
    int x[3] = { 0 }, y[3] = { 0 };
    swscanf(a, L"%d.%d.%d", &x[0], &x[1], &x[2]);
    swscanf(b, L"%d.%d.%d", &y[0], &y[1], &y[2]);
    for (int i = 0; i < 3; i++) if (x[i] != y[i]) return x[i] > y[i];
    return 0;
}

static DWORD WINAPI update_thread(LPVOID unused) {
    (void)unused;
    wchar_t info[1300], tmp[MAX_PATH], next[MAX_PATH], old[MAX_PATH], dl[1300];
    swprintf(info, 1300, L"%ls%lsrest_route=/moraba-panel/v1/app/info&_=%llu", g_url, wcschr(g_url, L'?') ? L"&" : L"?", (unsigned long long)GetTickCount64());
    swprintf(tmp, MAX_PATH, L"%ls\\update.json", g_home);
    if (FAILED(URLDownloadToFileW(NULL, info, tmp, 0, NULL))) return 0;
    char buf[4096] = { 0 };
    DWORD got = 0;
    HANDLE f = CreateFileW(tmp, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return 0;
    ReadFile(f, buf, sizeof(buf) - 1, &got, NULL);
    CloseHandle(f);
    DeleteFileW(tmp);
    char *v = strstr(buf, "\"desktop\":\"");
    if (!v) return 0;
    v += 11;
    wchar_t ver[32] = { 0 };
    for (int i = 0; i < 31 && v[i] && v[i] != '"'; i++) ver[i] = (wchar_t)v[i];
    if (!newer(ver, APP_VERSION) || (g_updated && !newer(ver, g_new_version))) return 0;
    swprintf(dl, 1300, L"%ls%lsmp_chat_exe=%ls", g_url, wcschr(g_url, L'?') ? L"&" : L"?", ver);
    swprintf(next, MAX_PATH, L"%ls\\MorabaChat.new.exe", g_home);
    if (FAILED(URLDownloadToFileW(NULL, dl, next, 0, NULL))) return 0;
    /* a sane Windows program, then swap: the running copy may be renamed, not overwritten */
    char mz[2] = { 0 };
    WIN32_FILE_ATTRIBUTE_DATA fa;
    f = CreateFileW(next, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f != INVALID_HANDLE_VALUE) { ReadFile(f, mz, 2, &got, NULL); CloseHandle(f); }
    if (mz[0] != 'M' || mz[1] != 'Z' || !GetFileAttributesExW(next, GetFileExInfoStandard, &fa) || fa.nFileSizeLow < 100000) { DeleteFileW(next); return 0; }
    swprintf(old, MAX_PATH, L"%ls\\MorabaChat.old.exe", g_home);
    DeleteFileW(old);
    if (!MoveFileExW(g_self, old, MOVEFILE_REPLACE_EXISTING)) { DeleteFileW(next); return 0; }
    if (!MoveFileExW(next, g_self, MOVEFILE_REPLACE_EXISTING)) { MoveFileExW(old, g_self, MOVEFILE_REPLACE_EXISTING); return 0; }
    wcsncpy(g_new_version, ver, 31);
    PostMessageW(g_wnd, WM_UPDATED, 0, 0);
    return 0;
}

static void restart(void) {
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    wchar_t cmd[MAX_PATH + 8];
    swprintf(cmd, MAX_PATH + 8, L"\"%ls\"", g_self);
    g_quitting = 1;
    save_placement();
    Shell_NotifyIconW(NIM_DELETE, &g_nid);
    if (CreateProcessW(g_self, cmd, NULL, NULL, FALSE, 0, NULL, g_home, &si, &pi)) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
    DestroyWindow(g_wnd);
}

/* ------------------------------------------------------------------ the window */

static LRESULT CALLBACK wnd_proc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == g_taskbar_msg && g_taskbar_msg) {
        if (!g_taskbar && SUCCEEDED(CoCreateInstance(&CLSID_TaskbarList, NULL, CLSCTX_INPROC_SERVER, &IID_ITaskbarList3, (void **)&g_taskbar))) ITaskbarList3_HrInit(g_taskbar);
        int n = g_unread; g_unread = -1; set_unread(n < 0 ? 0 : n);
        return 0;
    }
    switch (msg) {
    case WM_SIZE:
        resize_web();
        set_visible(wp != SIZE_MINIMIZED && IsWindowVisible(h));
        return 0;
    case WM_MOVE:
        if (g_ctl) ICoreWebView2Controller_NotifyParentWindowPositionChanged(g_ctl);
        return 0;
    case WM_ACTIVATE: {
        int on = LOWORD(wp) != WA_INACTIVE;
        if (on != g_focused) {
            g_focused = on;
            post_json(on ? L"{\"t\":\"focus\",\"on\":1}" : L"{\"t\":\"focus\",\"on\":0}");
        }
        if (on && g_ctl) ICoreWebView2Controller_MoveFocus(g_ctl, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        return 0;
    }
    case WM_GETMINMAXINFO: {
        MINMAXINFO *mm = (MINMAXINFO *)lp;
        mm->ptMinTrackSize.x = 420; mm->ptMinTrackSize.y = 480;
        return 0;
    }
    case WM_TIMER:
        if (wp == T_TICK) post_json(L"{\"t\":\"tick\"}");
        else if (wp == T_RETRY) { KillTimer(h, T_RETRY); if (g_web) ICoreWebView2_Navigate(g_web, g_url); }
        else if (wp == T_UPDATE) CloseHandle(CreateThread(NULL, 0, update_thread, NULL, 0, NULL));
        return 0;
    case WM_HOTKEY:
        toggle_window();
        return 0;
    case WM_TRAY:
        switch (LOWORD(lp)) {
        case WM_LBUTTONUP: case NIN_SELECT: case NIN_KEYSELECT: toggle_window(); break;
        case WM_CONTEXTMENU: case WM_RBUTTONUP: tray_menu(); break;
        case NIN_BALLOONUSERCLICK: {
            show_window();
            if (g_last_channel) { wchar_t j[64]; swprintf(j, 64, L"{\"t\":\"open\",\"channel\":%d}", g_last_channel); post_json(j); }
            break;
        }
        }
        return 0;
    case WM_COMMAND:
        switch (LOWORD(wp)) {
        case ID_OPEN: show_window(); break;
        case ID_DND_1H: g_dnd_until = GetTickCount64() + 3600000ULL; break;
        case ID_DND_8H: g_dnd_until = GetTickCount64() + 8 * 3600000ULL; break;
        case ID_DND_TOMORROW: {
            SYSTEMTIME st; GetLocalTime(&st);
            ULONGLONG left = ((24ULL - st.wHour + 8) % 24 ? (24ULL - st.wHour + 8) : 24) * 3600000ULL - (st.wMinute * 60000ULL);
            g_dnd_until = GetTickCount64() + left; /* until 8 in the morning */
            break;
        }
        case ID_DND_OFF: g_dnd_until = 0; break;
        case ID_NOTIFY: reg_set(L"notify", !reg_get(L"notify", 1)); break;
        case ID_AUTOSTART: set_autostart(!reg_get(L"autostart", 1)); break;
        case ID_SETTINGS: show_window(); settings_to_page(); break;
        case ID_RESTART: restart(); break;
        case ID_EXIT: g_quitting = 1; if (IsWindowVisible(h)) save_placement(); DestroyWindow(h); break;
        }
        tray_tip();
        g_nid.uFlags = NIF_TIP | NIF_SHOWTIP;
        Shell_NotifyIconW(NIM_MODIFY, &g_nid);
        return 0;
    case WM_UPDATED:
        g_updated = 1;
        g_last_channel = 0;
        g_nid.uFlags = NIF_INFO | NIF_SHOWTIP;
        lstrcpynW(g_nid.szInfoTitle, APP_NAME, 64);
        swprintf(g_nid.szInfo, 256, L"\x0646\x0633\x062E\x0647 %ls \x0622\x0645\x0627\x062F\x0647 \x0627\x0633\x062A\x061B \x0628\x0627 \x0628\x0633\x062A\x0646 \x0648 \x0628\x0627\x0632 \x06A9\x0631\x062F\x0646 \x062F\x0648\x0628\x0627\x0631\x0647 (\x06CC\x0627 \x0627\x0632 \x0645\x0646\x0648\x06CC \x0622\x06CC\x06A9\x0648\x0646) \x0627\x0639\x0645\x0627\x0644 \x0645\x06CC\x200C\x0634\x0648\x062F.", g_new_version);
        g_nid.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON | NIIF_NOSOUND;
        g_nid.hBalloonIcon = g_icon;
        Shell_NotifyIconW(NIM_MODIFY, &g_nid);
        return 0;
    case WM_COPYDATA: { /* a second copy was started: its command line */
        COPYDATASTRUCT *cd = (COPYDATASTRUCT *)lp;
        command(cd && cd->dwData == 0x4D43 ? (const wchar_t *)cd->lpData : L"");
        return TRUE;
    }
    case WM_QUERYENDSESSION:
        g_quitting = 1;
        save_placement();
        return TRUE;
    case WM_CLOSE:
        if (!g_quitting && reg_get(L"tray", 1)) { hide_window(); return 0; }
        g_quitting = 1;
        save_placement();
        DestroyWindow(h);
        return 0;
    case WM_DESTROY:
        Shell_NotifyIconW(NIM_DELETE, &g_nid);
        if (g_ctl) ICoreWebView2Controller_Close(g_ctl);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, msg, wp, lp);
}

/* ------------------------------------------------------------------ install + the old way (no WebView2) */

static void shortcut(const wchar_t *lnk, const wchar_t *target, const wchar_t *workdir) {
    IShellLinkW *sl = NULL;
    if (FAILED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&sl))) return;
    IShellLinkW_SetPath(sl, target);
    IShellLinkW_SetWorkingDirectory(sl, workdir);
    IShellLinkW_SetIconLocation(sl, target, 0);
    IShellLinkW_SetDescription(sl, APP_NAME);
    IPropertyStore *ps = NULL;
    if (SUCCEEDED(IShellLinkW_QueryInterface(sl, &IID_IPropertyStore, (void **)&ps))) {
        PROPVARIANT pv;
        if (SUCCEEDED(pv_string(APP_ID, &pv))) {
            IPropertyStore_SetValue(ps, &PKEY_AppUserModel_ID, &pv);
            IPropertyStore_Commit(ps);
            PropVariantClear(&pv);
        }
        IPropertyStore_Release(ps);
    }
    IPersistFile *pf = NULL;
    if (SUCCEEDED(IShellLinkW_QueryInterface(sl, &IID_IPersistFile, (void **)&pf))) {
        if (FAILED(IPersistFile_Save(pf, lnk, TRUE))) {
            /* a file system that refuses the Persian name: «Moraba Chat.lnk» instead */
            wchar_t alt[MAX_PATH];
            lstrcpynW(alt, lnk, MAX_PATH);
            wchar_t *slash = wcsrchr(alt, L'\\');
            if (slash) { slash[1] = 0; lstrcatW(alt, L"Moraba Chat.lnk"); IPersistFile_Save(pf, alt, TRUE); }
        }
        IPersistFile_Release(pf);
    }
    IShellLinkW_Release(sl);
}

/** folder\مربع چت.lnk (built by hand: the C runtime's printf stops at the Persian name). */
static void link_path(wchar_t *lnk, const wchar_t *folder) {
    lstrcpynW(lnk, folder, MAX_PATH - 16);
    lstrcatW(lnk, L"\\");
    lstrcatW(lnk, APP_NAME);
    lstrcatW(lnk, L".lnk");
}

/** First run from elsewhere: a copy in %LOCALAPPDATA%\MorabaChat, Start menu / desktop shortcuts. Returns 1 when
 *  the running program is not that copy (it then starts the copy and ends). */
static int install(void) {
    wchar_t local[MAX_PATH], target[MAX_PATH], lnk[MAX_PATH], folder[MAX_PATH];
    if (!GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH)) return 0;
    swprintf(g_home, MAX_PATH, L"%ls\\MorabaChat", local);
    CreateDirectoryW(g_home, NULL);
    swprintf(target, MAX_PATH, L"%ls\\MorabaChat.exe", g_home);
    int elsewhere = lstrcmpiW(g_self, target) != 0;
    if (elsewhere) {
        if (!CopyFileW(g_self, target, FALSE)) { /* the installed copy is running: start it anyway */ }
        /* the address written into this download wins over an older site.txt */
        wchar_t txt[MAX_PATH];
        swprintf(txt, MAX_PATH, L"%ls\\site.txt", g_home);
        if (SITE_URL[0] == L'h') DeleteFileW(txt);
    }
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, folder))) { link_path(lnk, folder); shortcut(lnk, target, g_home); }
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, folder))) { link_path(lnk, folder); if (!exists(lnk)) shortcut(lnk, target, g_home); }
    if (reg_get(L"installed", 0) == 0) { reg_set(L"installed", 1); set_autostart(1); }
    else if (reg_get(L"autostart", 1)) set_autostart(1); /* keep the Run entry pointing at this copy */
    if (elsewhere && exists(target)) return 1;
    return 0;
}

/** Starts the installed copy (after this one let go of the single-copy lock). */
static int run_installed(void) {
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    wchar_t target[MAX_PATH], cmd[MAX_PATH + 8];
    swprintf(target, MAX_PATH, L"%ls\\MorabaChat.exe", g_home);
    swprintf(cmd, MAX_PATH + 8, L"\"%ls\"", target);
    if (!CreateProcessW(target, cmd, NULL, NULL, FALSE, 0, NULL, g_home, &si, &pi)) return 0;
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return 1;
}

static int find_browser(wchar_t *out) {
    const wchar_t *env[] = { L"ProgramFiles(x86)", L"ProgramFiles", L"LOCALAPPDATA" };
    const wchar_t *rel[] = { L"Microsoft\\Edge\\Application\\msedge.exe", L"Google\\Chrome\\Application\\chrome.exe" };
    for (int b = 0; b < 2; b++)
        for (int e = 0; e < 3; e++) {
            wchar_t base[MAX_PATH];
            if (!GetEnvironmentVariableW(env[e], base, MAX_PATH)) continue;
            swprintf(out, MAX_PATH, L"%ls\\%ls", base, rel[b]);
            if (exists(out)) return 1;
        }
    return 0;
}

/** No WebView2 (very old Windows 10 without updates): the chat in an Edge or Chrome app window, as in version 1. */
static void edge_app(void) {
    wchar_t browser[MAX_PATH], args[2400], profile[MAX_PATH];
    swprintf(profile, MAX_PATH, L"%ls\\Profile", g_home);
    if (find_browser(browser)) {
        swprintf(args, 2400, L"\"%ls\" --app=\"%ls\" --user-data-dir=\"%ls\" --no-first-run --no-default-browser-check", browser, g_url, profile);
        STARTUPINFOW si = { sizeof(si) };
        PROCESS_INFORMATION pi;
        if (CreateProcessW(browser, args, NULL, NULL, FALSE, 0, NULL, g_home, &si, &pi)) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); return; }
    }
    ShellExecuteW(NULL, L"open", g_url, NULL, NULL, SW_SHOWNORMAL);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, LPWSTR cmdline, int show) {
    (void)prev;
    g_inst = inst;
    GetModuleFileNameW(NULL, g_self, MAX_PATH);
    wcscpy(g_home, g_self);
    dir_of(g_home);
    SetCurrentProcessExplicitAppUserModelID(APP_ID);
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    /* one copy only: a second start hands its command line to the first and ends */
    HANDLE single = CreateMutexW(NULL, TRUE, L"Local\\MorabaChat.Single");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND other = FindWindowW(WND_CLASS, NULL);
        wchar_t local[MAX_PATH], installed[MAX_PATH];
        int fresh = GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH) && (swprintf(installed, MAX_PATH, L"%ls\\MorabaChat\\MorabaChat.exe", local), lstrcmpiW(g_self, installed) != 0);
        if (other && fresh) {
            /* a newly downloaded copy: the running one steps aside so this one can install itself */
            COPYDATASTRUCT q = { 0x4D43, (DWORD)sizeof(L"--quit"), (PVOID)L"--quit" };
            SendMessageW(other, WM_COPYDATA, 0, (LPARAM)&q);
            DWORD r = WaitForSingleObject(single, 8000);
            if (r != WAIT_OBJECT_0 && r != WAIT_ABANDONED) return 0;
        } else {
            if (other) {
                COPYDATASTRUCT cd = { 0x4D43, (DWORD)((wcslen(cmdline) + 1) * sizeof(wchar_t)), cmdline };
                DWORD pid = 0;
                GetWindowThreadProcessId(other, &pid);
                AllowSetForegroundWindow(pid);
                SendMessageW(other, WM_COPYDATA, 0, (LPARAM)&cd);
            }
            return 0;
        }
    }
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (install()) {
        ReleaseMutex(single);
        CloseHandle(single);
        if (run_installed()) return 0;
        single = CreateMutexW(NULL, TRUE, L"Local\\MorabaChat.Single"); /* could not start the copy: carry on from here */
    }
    {   /* what an update left behind */
        wchar_t old[MAX_PATH];
        swprintf(old, MAX_PATH, L"%ls\\MorabaChat.old.exe", g_home);
        DeleteFileW(old);
    }
    read_url();
    if (!g_url[0] || wcsncmp(g_url, L"http", 4) != 0) {
        MessageBoxW(NULL, L"\x0622\x062F\x0631\x0633 \x0633\x0627\x06CC\x062A \x062F\x0631 \x0627\x06CC\x0646 \x0641\x0627\x06CC\x0644 \x0646\x06CC\x0633\x062A\x061B \x0627\x067E \x0631\x0627 \x0627\x0632 \x067E\x0646\x0644 \x0645\x0631\x0628\x0639 \x062F\x0627\x0646\x0644\x0648\x062F \x06A9\x0646\x06CC\x062F.",
            APP_NAME, MB_ICONWARNING | MB_RTLREADING | MB_RIGHT);
        return 1;
    }
    jump_list();

    g_icon = (HICON)LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), 0);
    g_icon_sm = (HICON)LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
    WNDCLASSEXW wc = { sizeof(wc) };
    wc.lpfnWndProc = wnd_proc;
    wc.hInstance = inst;
    wc.hIcon = g_icon;
    wc.hIconSm = g_icon_sm;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(0x16, 0x16, 0x16));
    wc.lpszClassName = WND_CLASS;
    RegisterClassExW(&wc);
    g_taskbar_msg = RegisterWindowMessageW(L"TaskbarButtonCreated");

    /* a comfortable first size; afterwards, where the person left it */
    int sw = GetSystemMetrics(SM_CXSCREEN), shh = GetSystemMetrics(SM_CYSCREEN);
    int w = sw > 1400 ? 1180 : sw * 85 / 100, hgt = shh > 900 ? 780 : shh * 85 / 100;
    g_wnd = CreateWindowExW(WS_EX_APPWINDOW, WND_CLASS, APP_NAME, WS_OVERLAPPEDWINDOW, (sw - w) / 2, (shh - hgt) / 2, w, hgt, NULL, NULL, inst, NULL);
    if (!g_wnd) return 1;
    BOOL dark = TRUE;
    DwmSetWindowAttribute(g_wnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof(dark));
    COLORREF cap = RGB(0x16, 0x16, 0x16), txt = RGB(0xEE, 0xEE, 0xEE);
    DwmSetWindowAttribute(g_wnd, 35 /* DWMWA_CAPTION_COLOR (Windows 11) */, &cap, sizeof(cap));
    DwmSetWindowAttribute(g_wnd, 36 /* DWMWA_TEXT_COLOR */, &txt, sizeof(txt));

    WINDOWPLACEMENT wp = { sizeof(wp) };
    DWORD wsz = sizeof(wp);
    int placed = RegGetValueW(HKEY_CURRENT_USER, REG_KEY, L"placement", RRF_RT_REG_BINARY, NULL, &wp, &wsz) == ERROR_SUCCESS && wsz == sizeof(wp);
    int start_hidden = wcsstr(cmdline, L"--tray") != NULL;
    if (placed) {
        if (start_hidden) wp.showCmd = SW_HIDE;
        else if (wp.showCmd != SW_SHOWMAXIMIZED) wp.showCmd = SW_SHOWNORMAL;
        SetWindowPlacement(g_wnd, &wp);
    } else if (!start_hidden) ShowWindow(g_wnd, show == SW_SHOWMINIMIZED ? SW_SHOWNORMAL : show);
    UpdateWindow(g_wnd);

    /* the tray icon */
    g_nid.cbSize = sizeof(g_nid);
    g_nid.hWnd = g_wnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_ICON | NIF_TIP | NIF_MESSAGE | NIF_SHOWTIP;
    g_nid.uCallbackMessage = WM_TRAY;
    g_nid.hIcon = g_icon_sm;
    tray_tip();
    Shell_NotifyIconW(NIM_ADD, &g_nid);
    g_nid.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &g_nid);

    apply_hotkey();
    if (!start_webview()) {
        Shell_NotifyIconW(NIM_DELETE, &g_nid);
        DestroyWindow(g_wnd);
        edge_app();
        return 0;
    }
    SetTimer(g_wnd, T_UPDATE, 6 * 3600 * 1000, NULL);
    CloseHandle(CreateThread(NULL, 0, update_thread, NULL, 0, NULL));
    if (!start_hidden) command(cmdline);

    MSG m;
    while (GetMessageW(&m, NULL, 0, 0) > 0) {
        TranslateMessage(&m);
        DispatchMessageW(&m);
    }
    if (g_taskbar) ITaskbarList3_Release(g_taskbar);
    CoUninitialize();
    CloseHandle(single);
    return 0;
}
