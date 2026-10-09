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
#include <stdio.h>
#include <wtsapi32.h>
#include <powrprof.h>
#include <bcrypt.h>
#include <uxtheme.h>
#ifndef DECLSPEC_XFGVIRT
#define DECLSPEC_XFGVIRT(a, b)
#endif
#include "WebView2.h"
#include "update-key.h" /* the public key updates are signed with (sign.py) */

#ifndef APP_VERSION
#define APP_VERSION L"2.4.0"
#endif
#define APP_ID L"Moraba.Chat"
#define APP_NAME L"\x0645\x0631\x0628\x0639 \x0686\x062A" /* مربع چت */
#define WND_CLASS L"MorabaChatWnd"
#define POP_CLASS L"MorabaChatPop"
#define REG_KEY L"Software\\MorabaChat"
#define RUN_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Run"

/* Replaced in the downloaded file by the site's chat address (UTF-16LE, the rest of the 300 characters NUL). */
static volatile const wchar_t SITE_URL[300] = L"@@MORABA_CHAT_URL@@";

enum { WM_TRAY = WM_APP + 1, WM_UPDATED, WM_HOSTMSG, WM_TOAST };
enum { T_TICK = 1, T_RETRY, T_UPDATE, T_PRESENCE, T_MEMORY };
enum { ID_SNIP = 99, ID_OPEN = 100, ID_DND_1H, ID_DND_8H, ID_DND_TOMORROW, ID_DND_OFF, ID_NOTIFY, ID_AUTOSTART, ID_SETTINGS, ID_RESTART, ID_EXIT };

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
static wchar_t g_device[40], g_presence[64]; /* this computer's id for attendance; «حاضر از ۰۹:۱۲» */
static int g_locked, g_presence_on = 1;
static ULONGLONG g_snip_until;      /* a screenshot was asked for: the next picture on the clipboard goes to the chat */
static wchar_t *g_pending_share;     /* «ارسال به» from Explorer before the page was ready */
static int g_mica, g_mica_ok;        /* Windows 11's backdrop behind the window (opt-in, registry "mica") */
/* the page's theme (title bar, the colour behind the page) and interface scale, kept for the next start */
static COLORREF g_bg = RGB(0x16, 0x16, 0x16), g_ink = RGB(0xEE, 0xEE, 0xEE);
static int g_dark = 1;
static double g_zoom = 1.0;
static HBRUSH g_bg_brush;

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
static double json_dbl(const wchar_t *j, const wchar_t *key, double def) {
    const wchar_t *p = json_find(j, key);
    return p ? wcstod(p, NULL) : def;
}
static void json_str(const wchar_t *j, const wchar_t *key, wchar_t *out, size_t n) {
    const wchar_t *p = json_find(j, key);
    size_t i = 0;
    out[0] = 0;
    if (!p || *p != L'"') return;
    for (p++; *p && *p != L'"' && i + 1 < n; p++) {
        if (*p == L'\\' && p[1]) {
            p++;
            if (*p == L'n') out[i++] = L'\n'; /* kept: a notification shows several lines */
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
    if (g_presence[0] && wcslen(g_nid.szTip) + wcslen(g_presence) + 2 < 128) { lstrcatW(g_nid.szTip, L"\n"); lstrcatW(g_nid.szTip, g_presence); }
}

/* «(3) مربع چت — در انتظار شبکه…» (the page sends the network state) */
static wchar_t g_status[64];
static void set_title(void) {
    wchar_t t[160] = L"";
    if (g_unread > 0) swprintf(t, 160, L"(%d) ", g_unread);
    lstrcatW(t, APP_NAME);
    if (g_status[0]) { lstrcatW(t, L" \x2014 "); lstrcatW(t, g_status); }
    SetWindowTextW(g_wnd, t);
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
    set_title();
}


/* ------------------------------------------------------------------ Windows notifications with a reply box
 *
 * Toasts through WinRT (Windows.UI.Notifications), called by hand: mingw has no headers for them, so the few
 * interfaces needed are reached by their IIDs and vtable slots (after IUnknown's 3 and IInspectable's 3).
 * A toast carries a text box and «ارسال» / «خوانده شد», like Telegram; what the person does arrives on a worker
 * thread (Activated) and is handed to the window (WM_TOAST), which passes it to the page. Shown toasts are kept
 * alive, so answering one from the action centre still reaches us while the app runs. If WinRT is missing or
 * refuses (an old Windows 10, no Start-menu shortcut), the tray balloon is used as before. */
typedef struct HSTRING__ *RTSTR;
typedef HRESULT (WINAPI *RoGetActivationFactoryFn)(RTSTR, REFIID, void **);
typedef HRESULT (WINAPI *RoActivateInstanceFn)(RTSTR, void **);
typedef HRESULT (WINAPI *WindowsCreateStringFn)(const wchar_t *, UINT32, RTSTR *);
typedef HRESULT (WINAPI *WindowsDeleteStringFn)(RTSTR);
typedef const wchar_t *(WINAPI *WindowsGetStringRawBufferFn)(RTSTR, UINT32 *);
static RoGetActivationFactoryFn pRoGetActivationFactory;
static RoActivateInstanceFn pRoActivateInstance;
static WindowsCreateStringFn pWindowsCreateString;
static WindowsDeleteStringFn pWindowsDeleteString;
static WindowsGetStringRawBufferFn pWindowsGetStringRawBuffer;

static const GUID IID_ToastStatics = { 0x50ac103f, 0xd235, 0x4598, { 0xbb, 0xef, 0x98, 0xfe, 0x4d, 0x1a, 0x3a, 0xd4 } };
static const GUID IID_ToastFactory = { 0x04124b20, 0x82c6, 0x4229, { 0xb1, 0x09, 0xfd, 0x9e, 0xd4, 0x66, 0x2b, 0x53 } };
static const GUID IID_Toast2 = { 0x9dfb9fd1, 0x143a, 0x490e, { 0x90, 0xbf, 0xb9, 0xfb, 0xa7, 0x13, 0x2d, 0xe7 } };
static const GUID IID_ToastArgs = { 0xe3bf92f3, 0xc197, 0x436f, { 0x82, 0x65, 0x06, 0x25, 0x82, 0x4f, 0x8d, 0xac } };
static const GUID IID_ToastArgs2 = { 0xab7da512, 0xcc61, 0x568e, { 0x81, 0xbe, 0x30, 0x4a, 0xc3, 0x10, 0x38, 0xfa } };
static const GUID IID_InspMap = { 0x1b0d3570, 0x0877, 0x5ec2, { 0x8a, 0x2c, 0x3b, 0x95, 0x39, 0x50, 0x6a, 0xca } };
static const GUID IID_PropValue = { 0x4bd682dd, 0x7554, 0x40e9, { 0x9a, 0x9b, 0x82, 0x65, 0x4e, 0xde, 0x7e, 0x62 } };
static const GUID IID_XmlDoc = { 0xf7f3a506, 0x1e87, 0x42d6, { 0xbc, 0xfb, 0xb8, 0xc8, 0x09, 0xfa, 0x54, 0x94 } };
static const GUID IID_XmlDocIO = { 0x6cd0e74e, 0xee65, 0x4489, { 0x9e, 0xbf, 0xca, 0x43, 0xe8, 0x7b, 0xa6, 0x37 } };
static const GUID IID_ToastActivated = { 0xab54de2d, 0x97d9, 0x5528, { 0xb6, 0xad, 0x10, 0x5a, 0xfe, 0x15, 0x65, 0x30 } };
static const GUID IID_Agile = { 0x94ea2b94, 0xe9cc, 0x49e0, { 0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90 } };

#define VT(o, i) ((*(void ***)(o))[i])
typedef HRESULT (STDMETHODCALLTYPE *QiFn)(void *, REFIID, void **);
typedef ULONG (STDMETHODCALLTYPE *RelFn)(void *);
typedef HRESULT (STDMETHODCALLTYPE *Fn0)(void *);
typedef HRESULT (STDMETHODCALLTYPE *FnP)(void *, void *);
typedef HRESULT (STDMETHODCALLTYPE *FnPP)(void *, void *, void *);
static void rt_release(void *o) { if (o) ((RelFn)VT(o, 2))(o); }
static HRESULT rt_qi(void *o, REFIID iid, void **out) { *out = NULL; return ((QiFn)VT(o, 0))(o, iid, out); }
static RTSTR hs(const wchar_t *s) { RTSTR h = NULL; pWindowsCreateString(s, (UINT32)wcslen(s), &h); return h; }
static void hs_copy(RTSTR h, wchar_t *out, int n) { UINT32 len = 0; const wchar_t *p = h ? pWindowsGetStringRawBuffer(h, &len) : NULL; lstrcpynW(out, p ? p : L"", n); }

static void *g_notifier, *g_toast_factory, *g_toasts[12];
static int g_toast_ok = -1, g_toast_n;

/* Activated (worker thread): "reply:12\ntext" | "read:12" | "open:12" → the window */
static HRESULT STDMETHODCALLTYPE ta_qi(void *self, REFIID riid, void **out) {
    if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IID_ToastActivated) || IsEqualIID(riid, &IID_Agile)) { *out = self; return S_OK; }
    *out = NULL;
    return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE ta_ref(void *self) { (void)self; return 1; }
static HRESULT STDMETHODCALLTYPE ta_invoke(void *self, void *sender, void *args) {
    (void)self; (void)sender;
    wchar_t act[64] = L"", text[2000] = L"";
    void *a = NULL;
    if (args && SUCCEEDED(rt_qi(args, &IID_ToastArgs, &a)) && a) {
        RTSTR h = NULL;
        if (SUCCEEDED(((FnP)VT(a, 6))(a, &h)) && h) { hs_copy(h, act, 64); pWindowsDeleteString(h); }
        rt_release(a);
    }
    if (args && SUCCEEDED(rt_qi(args, &IID_ToastArgs2, &a)) && a) {
        void *set = NULL, *map = NULL, *val = NULL, *pv = NULL;
        if (SUCCEEDED(((FnP)VT(a, 6))(a, &set)) && set) {
            if (SUCCEEDED(rt_qi(set, &IID_InspMap, &map)) && map) {
                RTSTR key = hs(L"reply");
                if (SUCCEEDED(((FnPP)VT(map, 6))(map, key, &val)) && val) {
                    if (SUCCEEDED(rt_qi(val, &IID_PropValue, &pv)) && pv) {
                        RTSTR h = NULL;
                        if (SUCCEEDED(((FnP)VT(pv, 19))(pv, &h)) && h) { hs_copy(h, text, 2000); pWindowsDeleteString(h); }
                        rt_release(pv);
                    }
                    rt_release(val);
                }
                pWindowsDeleteString(key);
                rt_release(map);
            }
            rt_release(set);
        }
        rt_release(a);
    }
    size_t n = wcslen(act) + wcslen(text) + 2;
    wchar_t *msg = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, n * sizeof(wchar_t));
    if (!msg) return S_OK;
    lstrcpyW(msg, act); lstrcatW(msg, L"\n"); lstrcatW(msg, text);
    if (!PostMessageW(g_wnd, WM_TOAST, 0, (LPARAM)msg)) HeapFree(GetProcessHeap(), 0, msg);
    return S_OK;
}
static void *ta_vtbl[] = { (void *)ta_qi, (void *)ta_ref, (void *)ta_ref, (void *)ta_invoke };
static struct { void **vtbl; } g_toast_handler = { ta_vtbl };

static int toast_init(void) {
    if (g_toast_ok >= 0) return g_toast_ok;
    g_toast_ok = 0;
    if (!reg_get(L"toast", 1)) return 0; /* HKCU\Software\MorabaChat\toast = 0: the plain balloon */
    HMODULE m = LoadLibraryW(L"combase.dll");
    if (!m) return 0;
    pRoGetActivationFactory = (RoGetActivationFactoryFn)(void *)GetProcAddress(m, "RoGetActivationFactory");
    pRoActivateInstance = (RoActivateInstanceFn)(void *)GetProcAddress(m, "RoActivateInstance");
    pWindowsCreateString = (WindowsCreateStringFn)(void *)GetProcAddress(m, "WindowsCreateString");
    pWindowsDeleteString = (WindowsDeleteStringFn)(void *)GetProcAddress(m, "WindowsDeleteString");
    pWindowsGetStringRawBuffer = (WindowsGetStringRawBufferFn)(void *)GetProcAddress(m, "WindowsGetStringRawBuffer");
    if (!pRoGetActivationFactory || !pRoActivateInstance || !pWindowsCreateString || !pWindowsDeleteString || !pWindowsGetStringRawBuffer) return 0;
    void *statics = NULL;
    RTSTR cls = hs(L"Windows.UI.Notifications.ToastNotificationManager");
    if (SUCCEEDED(pRoGetActivationFactory(cls, &IID_ToastStatics, &statics)) && statics) {
        RTSTR id = hs(APP_ID);
        ((FnPP)VT(statics, 7))(statics, id, &g_notifier); /* CreateToastNotifierWithId */
        pWindowsDeleteString(id);
        rt_release(statics);
    }
    pWindowsDeleteString(cls);
    cls = hs(L"Windows.UI.Notifications.ToastNotification");
    pRoGetActivationFactory(cls, &IID_ToastFactory, &g_toast_factory);
    pWindowsDeleteString(cls);
    g_toast_ok = g_notifier && g_toast_factory;
    return g_toast_ok;
}

/* XML text: & < > " escaped; appended to a growing buffer */
static void xml_add(wchar_t *buf, size_t cap, const wchar_t *s, int esc) {
    size_t i = wcslen(buf);
    for (; *s && i + 8 < cap; s++) {
        const wchar_t *r = NULL;
        if (esc && *s == L'&') r = L"&amp;"; else if (esc && *s == L'<') r = L"&lt;"; else if (esc && *s == L'>') r = L"&gt;"; else if (esc && *s == L'"') r = L"&quot;";
        else if (*s < 0x20 && *s != L'\n') continue;
        if (r) { while (*r) buf[i++] = *r++; } else buf[i++] = *s;
    }
    buf[i] = 0;
}

static int toast_show(const wchar_t *title, const wchar_t *body, int channel, int reply) {
    if (!toast_init()) return 0;
    static wchar_t xml[4000];
    wchar_t ch[16];
    _itow(channel, ch, 10);
    xml[0] = 0;
    xml_add(xml, 4000, L"<toast launch=\"open:", 0); xml_add(xml, 4000, ch, 0);
    xml_add(xml, 4000, L"\"><visual><binding template=\"ToastGeneric\"><text hint-maxLines=\"1\">", 0);
    xml_add(xml, 4000, title, 1);
    xml_add(xml, 4000, L"</text><text>", 0);
    xml_add(xml, 4000, body, 1);
    xml_add(xml, 4000, L"</text></binding></visual>", 0);
    if (reply && channel > 0) {
        xml_add(xml, 4000, L"<actions><input id=\"reply\" type=\"text\" placeHolderContent=\"\x067E\x0627\x0633\x062E\x2026\"/>"
            L"<action content=\"\x0627\x0631\x0633\x0627\x0644\" arguments=\"reply:", 0);
        xml_add(xml, 4000, ch, 0);
        xml_add(xml, 4000, L"\" hint-inputId=\"reply\"/><action content=\"\x062E\x0648\x0627\x0646\x062F\x0647 \x0634\x062F\" arguments=\"read:", 0);
        xml_add(xml, 4000, ch, 0);
        xml_add(xml, 4000, L"\"/></actions>", 0);
    }
    if (!reg_get(L"sound", 1)) xml_add(xml, 4000, L"<audio silent=\"true\"/>", 0);
    xml_add(xml, 4000, L"</toast>", 0);

    void *insp = NULL, *io = NULL, *doc = NULL, *toast = NULL, *t2 = NULL;
    int ok = 0;
    RTSTR cls = hs(L"Windows.Data.Xml.Dom.XmlDocument"), x = hs(xml);
    if (SUCCEEDED(pRoActivateInstance(cls, &insp)) && insp && SUCCEEDED(rt_qi(insp, &IID_XmlDocIO, &io)) && io &&
        SUCCEEDED(((FnP)VT(io, 6))(io, x)) && SUCCEEDED(rt_qi(insp, &IID_XmlDoc, &doc)) && doc &&
        SUCCEEDED(((FnPP)VT(g_toast_factory, 6))(g_toast_factory, doc, &toast)) && toast) {
        if (SUCCEEDED(rt_qi(toast, &IID_Toast2, &t2)) && t2) {
            wchar_t tag[20] = L"c";
            lstrcatW(tag, ch);
            RTSTR ht = hs(tag), hg = hs(L"chat");
            ((FnP)VT(t2, 6))(t2, ht); /* put_Tag: a newer message of the same chat replaces the older toast */
            ((FnP)VT(t2, 8))(t2, hg); /* put_Group */
            pWindowsDeleteString(ht); pWindowsDeleteString(hg);
            rt_release(t2);
        }
        INT64 tok = 0;
        ((FnPP)VT(toast, 11))(toast, &g_toast_handler, &tok); /* add_Activated */
        ok = SUCCEEDED(((FnP)VT(g_notifier, 6))(g_notifier, toast)); /* Show */
    }
    pWindowsDeleteString(cls); pWindowsDeleteString(x);
    rt_release(doc); rt_release(io); rt_release(insp);
    if (ok) {
        int i = g_toast_n++ % 12;
        rt_release(g_toasts[i]);
        g_toasts[i] = toast;
    } else rt_release(toast);
    return ok;
}

/* JSON string body (quotes, backslashes, control characters escaped) */
static void json_add(wchar_t *buf, size_t cap, const wchar_t *s) {
    size_t i = wcslen(buf);
    for (; *s && i + 8 < cap; s++) {
        if (*s == L'"' || *s == L'\\') { buf[i++] = L'\\'; buf[i++] = *s; }
        else if (*s == L'\n') { buf[i++] = L'\\'; buf[i++] = L'n'; }
        else if (*s < 0x20) continue;
        else buf[i++] = *s;
    }
    buf[i] = 0;
}

static void show_window(void);

/** What the person did on a toast (WM_TOAST, UI thread). */
static void toast_action(wchar_t *m) {
    wchar_t *text = wcschr(m, L'\n');
    if (text) *text++ = 0;
    const wchar_t *c = wcschr(m, L':');
    int ch = c ? _wtoi(c + 1) : 0;
    if (!wcsncmp(m, L"reply:", 6) && ch) {
        if (!text || !*text) return;
        static wchar_t j[4400];
        swprintf(j, 64, L"{\"t\":\"reply\",\"channel\":%d,\"text\":\"", ch);
        json_add(j, 4390, text);
        lstrcatW(j, L"\"}");
        post_json(j);
    } else if (!wcsncmp(m, L"read:", 5) && ch) {
        wchar_t j[64];
        swprintf(j, 64, L"{\"t\":\"read\",\"channel\":%d}", ch);
        post_json(j);
    } else {
        show_window();
        if (ch) { wchar_t j[64]; swprintf(j, 64, L"{\"t\":\"open\",\"channel\":%d}", ch); post_json(j); }
    }
}

/** A Windows notification: a toast with a reply box, or the tray balloon (clicking either opens that chat). */
static void notify(const wchar_t *title, const wchar_t *body, int channel, int reply) {
    if (!reg_get(L"notify", 1) || dnd()) return;
    const wchar_t *shown = reg_get(L"preview", 1) && body && *body ? body : L"\x067E\x06CC\x0627\x0645 \x062A\x0627\x0632\x0647";
    if (toast_show(title && *title ? title : APP_NAME, shown, channel, reply)) {
        if (GetForegroundWindow() != g_wnd) {
            FLASHWINFO fw = { sizeof(fw), g_wnd, FLASHW_TRAY | FLASHW_TIMERNOFG, 0, 0 };
            FlashWindowEx(&fw);
        }
        return;
    }
    g_last_channel = channel;
    g_nid.uFlags = NIF_INFO | NIF_SHOWTIP;
    lstrcpynW(g_nid.szInfoTitle, title && *title ? title : APP_NAME, 64);
    lstrcpynW(g_nid.szInfo, shown, 256);
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

/* Hidden beside the clock for a while: the browser may drop caches and free memory (it keeps running, so
   notifications still arrive); back to normal the moment the window shows. */
static void memory_level(int low) {
    ICoreWebView2_19 *w19 = NULL;
    if (g_web && SUCCEEDED(ICoreWebView2_QueryInterface(g_web, &IID_ICoreWebView2_19, (void **)&w19)) && w19) {
        ICoreWebView2_19_put_MemoryUsageTargetLevel(w19, low ? COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW : COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
        ICoreWebView2_19_Release(w19);
    }
}

static void show_window(void) {
    if (IsIconic(g_wnd)) ShowWindow(g_wnd, SW_RESTORE); else ShowWindow(g_wnd, SW_SHOW);
    SetForegroundWindow(g_wnd);
    set_visible(1);
    if (g_ctl) ICoreWebView2Controller_MoveFocus(g_ctl, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    KillTimer(g_wnd, T_MEMORY);
    memory_level(0);
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
    SetTimer(g_wnd, T_MEMORY, 5 * 60000, NULL);
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
    menu_item(m, ID_SNIP, L"\x0627\x0633\x06A9\x0631\x06CC\x0646\x200C\x0634\x0627\x062A \x0648 \x0627\x0631\x0633\x0627\x0644\x2026", 0, 0); /* اسکرین‌شات و ارسال… */
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
    swprintf(j, 300, L"{\"t\":\"settings\",\"v\":{\"autostart\":%lu,\"tray\":%lu,\"notify\":%lu,\"sound\":%lu,\"preview\":%lu,\"hotkey\":%lu,\"sysframe\":%lu}}",
        reg_get(L"autostart", 1), reg_get(L"tray", 1), reg_get(L"notify", 1), reg_get(L"sound", 1), reg_get(L"preview", 1), reg_get(L"hotkey", 1), reg_get(L"sysframe", 0));
    post_json(j);
}

static void apply_hotkey(void) {
    UnregisterHotKey(g_wnd, 1);
    if (reg_get(L"hotkey", 1)) RegisterHotKey(g_wnd, 1, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, 'M');
}

/* ------------------------------------------------------------------ automatic attendance
 *
 * Every minute, and at once on lock, unlock, sleep, wake and shutdown, the page is told how long it has been
 * since the last keyboard or mouse input on this computer, whether the session is locked, and whether something
 * keeps the screen on (a call, a meeting). The page sends it to the site (POST presence), which turns it into
 * attendance (includes/class-mp-presence.php): only time with real work counts; idle, locked, asleep or switched
 * off does not. The answer («حاضر از ۰۹:۱۲») shows in the tray tooltip. */
static void device_id(void) {
    DWORD sz = sizeof(g_device);
    if (RegGetValueW(HKEY_CURRENT_USER, REG_KEY, L"device", RRF_RT_REG_SZ, NULL, g_device, &sz) == ERROR_SUCCESS && g_device[0]) return;
    GUID g;
    CoCreateGuid(&g);
    swprintf(g_device, 40, L"w%08lx%04x%04x%02x%02x%02x%02x%02x%02x", (unsigned long)g.Data1, g.Data2, g.Data3, g.Data4[0], g.Data4[1], g.Data4[2], g.Data4[3], g.Data4[4], g.Data4[5]);
    HKEY k;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, REG_KEY, 0, NULL, 0, KEY_SET_VALUE, NULL, &k, NULL) == ERROR_SUCCESS) {
        RegSetValueExW(k, L"device", 0, REG_SZ, (const BYTE *)g_device, (DWORD)((wcslen(g_device) + 1) * sizeof(wchar_t)));
        RegCloseKey(k);
    }
}

static DWORD idle_seconds(void) {
    LASTINPUTINFO li = { sizeof(li) };
    if (!GetLastInputInfo(&li)) return 0;
    return (GetTickCount() - li.dwTime) / 1000; /* the tick count goes on during sleep, so idle does too */
}

/* A program holding the screen on (a video call, a meeting, a presentation) counts as being there — but only up
   to 45 minutes without any input, so a film left playing does not fill the night. */
static int screen_held(DWORD idle) {
    EXECUTION_STATE st = 0;
    if (idle > 45 * 60) return 0;
    if (CallNtPowerInformation(SystemExecutionState, NULL, 0, &st, sizeof(st)) != 0) return 0;
    return (st & ES_DISPLAY_REQUIRED) != 0;
}

static void activity(const wchar_t *ev) {
    if (!g_loaded || !g_web) return;
    DWORD idle = idle_seconds();
    wchar_t j[220];
    swprintf(j, 220, L"{\"t\":\"activity\",\"ev\":\"%ls\",\"idle\":%lu,\"locked\":%d,\"busy\":%d,\"device\":\"%ls\"}",
        ev, (unsigned long)idle, g_locked, !g_locked && screen_held(idle), g_device);
    post_json(j);
}

/* the site's answer: {"t":"presence","on":1,"present":1,"since":"09:12"} */
static void presence_state(const wchar_t *j) {
    int on = (int)json_num(j, L"on", 1), present = (int)json_num(j, L"present", 0);
    wchar_t since[8];
    json_str(j, L"since", since, 8);
    g_presence[0] = 0;
    if (on && present) {
        lstrcpyW(g_presence, L"\x062D\x0627\x0636\x0631"); /* حاضر */
        if (since[0]) { lstrcatW(g_presence, L" \x0627\x0632 "); lstrcatW(g_presence, since); } /* از 09:12 */
    }
    if (on != g_presence_on) {
        g_presence_on = on;
        SetTimer(g_wnd, T_PRESENCE, on ? 60000 : 15 * 60000, NULL); /* switched off on the site: ask now and then */
    }
    tray_tip();
    g_nid.uFlags = NIF_TIP | NIF_SHOWTIP;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
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

/* ------------------------------------------------------------------ screenshot → chat, Explorer → chat */

/* Windows' own snipping (Win+Shift+S) opens; the picture it puts on the clipboard goes to the page (WM_CLIPBOARDUPDATE). */
static void snip(void) {
    g_snip_until = GetTickCount64() + 120000;
    AddClipboardFormatListener(g_wnd);
#ifdef HOST_TEST /* Wine has no snipping tool: the test puts a picture on the clipboard itself */
    return;
#endif
    if ((INT_PTR)ShellExecuteW(NULL, L"open", L"ms-screenclip:", NULL, NULL, SW_SHOWNORMAL) <= 32) {
        /* older Windows 10: the Snipping Tool */
        ShellExecuteW(NULL, L"open", L"SnippingTool.exe", L"/clip", NULL, SW_SHOWNORMAL);
    }
}

/* MorabaChat.exe --share "C:\a.png" "C:\b.pdf" (the «ارسال به» menu): the files go to the page as file handles
   (WebView2 runtime 128+); the page asks which chat. */
static void share_files(const wchar_t *args) {
    if (!g_loaded || !g_web || !g_env) { /* still starting: once the page is there */
        if (g_pending_share) HeapFree(GetProcessHeap(), 0, g_pending_share);
        size_t n = (wcslen(args) + 1) * sizeof(wchar_t);
        g_pending_share = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, n);
        if (g_pending_share) memcpy(g_pending_share, args, n);
        return;
    }
    int argc = 0, k = 0;
    LPWSTR *argv = CommandLineToArgvW(args, &argc);
    if (!argv) return;
    IUnknown *items[32];
    ICoreWebView2Environment14 *e14 = NULL;
    if (SUCCEEDED(ICoreWebView2Environment_QueryInterface(g_env, &IID_ICoreWebView2Environment14, (void **)&e14)) && e14) {
        int after = 0;
        for (int i = 0; i < argc && k < 32; i++) {
            if (!wcscmp(argv[i], L"--share")) { after = 1; continue; }
            if (!after || argv[i][0] == L'-' || GetFileAttributesW(argv[i]) & FILE_ATTRIBUTE_DIRECTORY) continue;
            ICoreWebView2FileSystemHandle *fh = NULL;
            if (SUCCEEDED(ICoreWebView2Environment14_CreateWebFileSystemFileHandle(e14, argv[i], COREWEBVIEW2_FILE_SYSTEM_HANDLE_PERMISSION_READ_ONLY, &fh)) && fh) items[k++] = (IUnknown *)fh;
        }
        ICoreWebView2ObjectCollection *col = NULL;
        ICoreWebView2ObjectCollectionView *view = NULL;
        ICoreWebView2_23 *w23 = NULL;
        int sent = 0;
        if (k && SUCCEEDED(ICoreWebView2Environment14_CreateObjectCollection(e14, (UINT32)k, items, &col)) && col &&
            SUCCEEDED(ICoreWebView2ObjectCollection_QueryInterface(col, &IID_ICoreWebView2ObjectCollectionView, (void **)&view)) && view &&
            SUCCEEDED(ICoreWebView2_QueryInterface(g_web, &IID_ICoreWebView2_23, (void **)&w23)) && w23)
            sent = SUCCEEDED(ICoreWebView2_23_PostWebMessageAsJsonWithAdditionalObjects(w23, L"{\"t\":\"share\"}", view));
        if (w23) ICoreWebView2_23_Release(w23);
        if (view) ICoreWebView2ObjectCollectionView_Release(view);
        if (col) ICoreWebView2ObjectCollection_Release(col);
        for (int i = 0; i < k; i++) items[i]->lpVtbl->Release(items[i]);
        ICoreWebView2Environment14_Release(e14);
        if (sent) { LocalFree(argv); return; }
    }
    LocalFree(argv);
    /* an old WebView2 runtime: say how to send instead */
    g_nid.uFlags = NIF_INFO | NIF_SHOWTIP;
    lstrcpynW(g_nid.szInfoTitle, APP_NAME, 64);
    lstrcpynW(g_nid.szInfo, L"\x0641\x0627\x06CC\x0644 \x0631\x0627 \x0628\x0647 \x067E\x0646\x062C\x0631\x0647 \x06AF\x0641\x062A\x200C\x0648\x06AF\x0648 \x0628\x06A9\x0634\x06CC\x062F.", 256); /* فایل را به پنجره گفت‌وگو بکشید. */
    g_nid.dwInfoFlags = NIIF_USER | NIIF_NOSOUND;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

static void command(const wchar_t *args) {
    if (!args) args = L"";
    if (wcsstr(args, L"--quit")) { g_quitting = 1; if (IsWindowVisible(g_wnd)) save_placement(); DestroyWindow(g_wnd); return; }
    if (wcsstr(args, L"--tray")) return;
    show_window();
    if (wcsstr(args, L"--share")) { share_files(args); return; }
    if (wcsstr(args, L"--snip")) { snip(); return; }
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

static void open_pop(int channel, const wchar_t *title);
static HWND pop_window(ICoreWebView2 *web);
static void apply_theme(const wchar_t *j);
static void apply_zoom(double z);
static void web_colour(ICoreWebView2Controller *ctl);
static void set_frame(int custom);
static void restart(void);
static void share_files(const wchar_t *args);
static void resize_web(void);

/* page → host (the main window and the separate chat windows alike) */
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
        notify(title, body, (int)json_num(j, L"channel", 0), !json_num(j, L"noreply", 0));
    } else if (!wcscmp(t, L"set")) {
        wchar_t k[24];
        long v = json_num(j, L"v", 0);
        json_str(j, L"k", k, 24);
        if (!wcscmp(k, L"autostart")) set_autostart(v != 0);
        else if (!wcscmp(k, L"mica")) reg_set(k, v ? 1 : 0); /* applies at the next start */
        else if (!wcscmp(k, L"sysframe")) { reg_set(k, v ? 1 : 0); set_frame(!v); resize_web(); }
        else if (!wcscmp(k, L"tray") || !wcscmp(k, L"notify") || !wcscmp(k, L"sound") || !wcscmp(k, L"preview") || !wcscmp(k, L"hotkey")) {
            reg_set(k, v ? 1 : 0);
            if (!wcscmp(k, L"hotkey")) apply_hotkey();
        }
    } else if (!wcscmp(t, L"settings?")) settings_to_page();
    else if (!wcscmp(t, L"show")) show_window();
    else if (!wcscmp(t, L"presence")) presence_state(j);
    else if (!wcscmp(t, L"theme")) apply_theme(j);
    else if (!wcscmp(t, L"status")) { json_str(j, L"text", g_status, 64); set_title(); }
    else if (!wcscmp(t, L"snip")) snip();
    else if (!wcscmp(t, L"restart")) restart();
    else if (!wcscmp(t, L"zoom")) apply_zoom(json_dbl(j, L"v", 1.0));
    else if (!wcscmp(t, L"hide")) { HWND pw = pop_window(sender); if (pw) DestroyWindow(pw); else if (reg_get(L"tray", 1)) hide_window(); else ShowWindow(g_wnd, SW_MINIMIZE); } /* Ctrl+W */
    else if (!wcscmp(t, L"quit")) { g_quitting = 1; save_placement(); DestroyWindow(g_wnd); } /* Ctrl+Q */
    else if (!wcscmp(t, L"popout")) {
        wchar_t title[128];
        json_str(j, L"title", title, 128);
        open_pop((int)json_num(j, L"channel", 0), title);
    }
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
        ICoreWebView2_Navigate(sender, dl); /* an attachment: WebView2 downloads it, the chat stays */
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
            ICoreWebView2_Navigate(sender, g_url);
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
    HWND owner = sender == g_web ? g_wnd : pop_window(sender);
    if (ok) {
        if (sender == g_web && !g_loaded) {
            g_loaded = 1;
            activity(L"start");
            if (g_pending_share) { wchar_t *a = g_pending_share; g_pending_share = NULL; share_files(a); HeapFree(GetProcessHeap(), 0, a); }
        }
        if (owner) KillTimer(owner, T_RETRY);
        return S_OK;
    }
    COREWEBVIEW2_WEB_ERROR_STATUS st = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
    ICoreWebView2NavigationCompletedEventArgs_get_WebErrorStatus(args, &st);
    if (st == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED) return S_OK;
    ICoreWebView2_NavigateToString(sender,
        L"<!doctype html><html dir=rtl lang=fa><meta charset=utf-8><style>html,body{height:100%;margin:0;background:#161616;color:#eee;font:15px 'Segoe UI',Tahoma,sans-serif;display:grid;place-items:center;text-align:center}"
        L"b{display:block;font-size:19px;margin-bottom:8px}i{display:inline-block;width:26px;height:26px;border:3px solid #444;border-top-color:#f28a24;border-radius:50%;animation:r 1s linear infinite;margin-top:18px}@keyframes r{to{transform:rotate(360deg)}}</style>"
        L"<div><b>\x0627\x062A\x0635\x0627\x0644 \x0628\x0631\x0642\x0631\x0627\x0631 \x0646\x06CC\x0633\x062A</b>\x0647\x0645\x06CC\x0646 \x06A9\x0647 \x0627\x06CC\x0646\x062A\x0631\x0646\x062A \x0648\x0635\x0644 \x0634\x0648\x062F\x060C \x06AF\x0641\x062A\x200C\x0648\x06AF\x0648\x0647\x0627 \x062E\x0648\x062F\x0634\x0627\x0646 \x0628\x0627\x0632 \x0645\x06CC\x200C\x0634\x0648\x0646\x062F.<br><i></i></div></html>");
    if (owner) SetTimer(owner, T_RETRY, 6000, NULL);
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

/* ------------------------------------------------------------------ the title bar (Telegram Desktop draws its own)
 *
 * The caption goes (WM_NCCALCSIZE keeps the side and bottom borders, so resizing, the shadow and Windows 11's
 * rounded corners stay) and a slim bar in the theme's colours takes its place: the title in the middle and
 * minimise / maximise / close on the right. Hit-testing answers HTCAPTION / HTMINBUTTON / HTMAXBUTTON / HTCLOSE, so
 * dragging, double-click, the system menu, Aero Snap and Windows 11's snap layouts (hover on maximise) work as
 * usual. Registry "sysframe" = 1 (settings → advanced → «قاب پنجره ویندوز») brings the normal frame back. */
static int g_custom, g_hot, g_pressed; /* g_hot / g_pressed: HTMINBUTTON, HTMAXBUTTON or HTCLOSE */

static UINT dpi_of(HWND h) { UINT d = GetDpiForWindow(h); return d ? d : 96; }
static int title_h(void) { return g_custom ? MulDiv(32, dpi_of(g_wnd), 96) : 0; }
static int frame_y(HWND h) { UINT d = dpi_of(h); return GetSystemMetricsForDpi(SM_CYFRAME, d) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, d); }
static COLORREF mix(COLORREF a, COLORREF b, int pct) {
    return RGB((GetRValue(a) * (100 - pct) + GetRValue(b) * pct) / 100, (GetGValue(a) * (100 - pct) + GetGValue(b) * pct) / 100, (GetBValue(a) * (100 - pct) + GetBValue(b) * pct) / 100);
}
/* the buttons from the right: close, maximise, minimise (client coordinates) */
static void button_rect(int which, RECT *r) {
    RECT c;
    GetClientRect(g_wnd, &c);
    int w = MulDiv(46, dpi_of(g_wnd), 96), i = which == HTCLOSE ? 0 : which == HTMAXBUTTON ? 1 : 2;
    r->right = c.right - i * w; r->left = r->right - w; r->top = 0; r->bottom = title_h();
}
static void invalidate_title(void) {
    if (!g_custom) return;
    RECT c;
    GetClientRect(g_wnd, &c);
    c.bottom = title_h();
    InvalidateRect(g_wnd, &c, FALSE);
}
static void paint_title_gdi(HDC dc);
/* With Mica the bar is see-through: drawn into a buffered 32-bit bitmap, text with alpha (DrawThemeTextEx). */
static void paint_title(HDC dc) {
    if (!g_mica) { paint_title_gdi(dc); return; }
    RECT c;
    GetClientRect(g_wnd, &c);
    c.bottom = title_h();
    HDC mem = NULL;
    BP_PAINTPARAMS pp = { sizeof(pp), BPPF_ERASE, NULL, NULL };
    HPAINTBUFFER pb = BeginBufferedPaint(dc, &c, BPBF_TOPDOWNDIB, &pp, &mem);
    if (!pb) { paint_title_gdi(dc); return; }
    UINT dpi = dpi_of(g_wnd);
    HTHEME th = OpenThemeData(g_wnd, L"WINDOW");
    COLORREF ink = g_focused ? g_ink : mix(g_ink, g_bg, 45);
    NONCLIENTMETRICSW ncm = { sizeof(ncm) };
    SystemParametersInfoForDpi(SPI_GETNONCLIENTMETRICS, sizeof(ncm), &ncm, 0, dpi);
    ncm.lfCaptionFont.lfWeight = FW_NORMAL;
    HFONT tf = CreateFontIndirectW(&ncm.lfCaptionFont), old = (HFONT)SelectObject(mem, tf);
    DTTOPTS o = { sizeof(o) };
    o.dwFlags = DTT_COMPOSITED | DTT_TEXTCOLOR;
    o.crText = ink;
    wchar_t t[120];
    GetWindowTextW(g_wnd, t, 120);
    RECT tr = c;
    tr.left += MulDiv(150, dpi, 96); tr.right -= MulDiv(150, dpi, 96);
    if (th) DrawThemeTextEx(th, mem, 0, 0, t, -1, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS, &tr, &o);
    HFONT gf = CreateFontW(-MulDiv(10, dpi, 96), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe MDL2 Assets");
    SelectObject(mem, gf);
    const int codes[3] = { HTMINBUTTON, HTMAXBUTTON, HTCLOSE };
    for (int i = 0; i < 3; i++) {
        RECT r;
        button_rect(codes[i], &r);
        o.crText = ink;
        if (codes[i] == g_hot || codes[i] == g_pressed) {
            COLORREF fill = codes[i] == HTCLOSE ? RGB(0xC4, 0x2B, 0x1C) : mix(g_bg, g_ink, 16);
            HBRUSH b = CreateSolidBrush(fill);
            FillRect(mem, &r, b);
            DeleteObject(b);
            BufferedPaintSetAlpha(pb, &r, 255);
            if (codes[i] == HTCLOSE) o.crText = RGB(255, 255, 255);
        }
        const wchar_t *glyph = codes[i] == HTMINBUTTON ? L"\xE921" : codes[i] == HTCLOSE ? L"\xE8BB" : IsZoomed(g_wnd) ? L"\xE923" : L"\xE922";
        if (th) DrawThemeTextEx(th, mem, 0, 0, glyph, 1, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX, &r, &o);
    }
    SelectObject(mem, old);
    DeleteObject(tf);
    DeleteObject(gf);
    if (th) CloseThemeData(th);
    EndBufferedPaint(pb, TRUE);
}

static void paint_title_gdi(HDC dc) {
    UINT dpi = dpi_of(g_wnd);
    RECT c;
    GetClientRect(g_wnd, &c);
    c.bottom = title_h();
    HBRUSH bg = CreateSolidBrush(g_bg);
    FillRect(dc, &c, bg);
    DeleteObject(bg);
    COLORREF ink = g_focused ? g_ink : mix(g_ink, g_bg, 45);
    SetBkMode(dc, TRANSPARENT);
    NONCLIENTMETRICSW ncm = { sizeof(ncm) };
    SystemParametersInfoForDpi(SPI_GETNONCLIENTMETRICS, sizeof(ncm), &ncm, 0, dpi);
    ncm.lfCaptionFont.lfWeight = FW_NORMAL;
    HFONT tf = CreateFontIndirectW(&ncm.lfCaptionFont), old = (HFONT)SelectObject(dc, tf);
    wchar_t t[120];
    GetWindowTextW(g_wnd, t, 120);
    RECT tr = c;
    tr.left += MulDiv(150, dpi, 96); tr.right -= MulDiv(150, dpi, 96);
    SetTextColor(dc, ink);
    DrawTextW(dc, t, -1, &tr, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
    HFONT gf = CreateFontW(-MulDiv(10, dpi, 96), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe MDL2 Assets");
    SelectObject(dc, gf);
    const int codes[3] = { HTMINBUTTON, HTMAXBUTTON, HTCLOSE };
    for (int i = 0; i < 3; i++) {
        RECT r;
        button_rect(codes[i], &r);
        COLORREF gl = ink;
        if (codes[i] == g_hot || codes[i] == g_pressed) {
            COLORREF fill = codes[i] == HTCLOSE ? (g_pressed == HTCLOSE ? RGB(0x94, 0x1E, 0x14) : RGB(0xC4, 0x2B, 0x1C)) : mix(g_bg, g_ink, g_pressed == codes[i] ? 20 : 11);
            HBRUSH b = CreateSolidBrush(fill);
            FillRect(dc, &r, b);
            DeleteObject(b);
            if (codes[i] == HTCLOSE) gl = RGB(255, 255, 255);
        }
        const wchar_t *glyph = codes[i] == HTMINBUTTON ? L"\xE921" : codes[i] == HTCLOSE ? L"\xE8BB" : IsZoomed(g_wnd) ? L"\xE923" : L"\xE922";
        SetTextColor(dc, gl);
        DrawTextW(dc, glyph, 1, &r, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
    SelectObject(dc, old);
    DeleteObject(tf);
    DeleteObject(gf);
}
/* where in the title bar (screen point): a button, the top resize edge, or the caption; HTNOWHERE below it */
static LRESULT title_hit(HWND h, LPARAM lp) {
    POINT pt = { GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
    ScreenToClient(h, &pt);
    if (pt.y < 0 || pt.y >= title_h()) return HTNOWHERE;
    RECT c;
    GetClientRect(h, &c);
    int edge = MulDiv(5, dpi_of(h), 96);
    if (!IsZoomed(h) && pt.y < edge) return pt.x < edge * 2 ? HTTOPLEFT : pt.x >= c.right - edge * 2 ? HTTOPRIGHT : HTTOP;
    const int codes[3] = { HTMINBUTTON, HTMAXBUTTON, HTCLOSE };
    for (int i = 0; i < 3; i++) { RECT r; button_rect(codes[i], &r); if (PtInRect(&r, pt)) return codes[i]; }
    return HTCAPTION;
}
static void set_frame(int custom) {
    g_custom = custom;
    g_hot = g_pressed = 0;
    SetWindowPos(g_wnd, NULL, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    InvalidateRect(g_wnd, NULL, TRUE);
}

static void resize_web(void) {
    if (!g_ctl) return;
    RECT rc;
    GetClientRect(g_wnd, &rc);
    rc.top += title_h();
    ICoreWebView2Controller_put_Bounds(g_ctl, rc);
}

/** The same browser settings and handlers for the main window and every separate chat window. */
static void setup_web(ICoreWebView2Controller *ctl, ICoreWebView2 *web) {
    /* the theme's colour behind the page (no white flash) and the chosen interface scale */
    web_colour(ctl);
    ICoreWebView2Controller_put_ZoomFactor(ctl, g_zoom);
    ICoreWebView2Settings *s = NULL;
    if (SUCCEEDED(ICoreWebView2_get_Settings(web, &s))) {
        ICoreWebView2Settings_put_AreDevToolsEnabled(s, FALSE);
        /* the page shows its own menus; text boxes get the browser's (spelling suggestions, paste…) */
        ICoreWebView2Settings_put_AreDefaultContextMenusEnabled(s, TRUE);
        ICoreWebView2Settings_put_IsStatusBarEnabled(s, FALSE);
        ICoreWebView2Settings_put_IsZoomControlEnabled(s, FALSE); /* the page's own scale (Ctrl+= / Ctrl+−) */
        ICoreWebView2Settings3 *s3 = NULL;
        if (SUCCEEDED(ICoreWebView2Settings_QueryInterface(s, &IID_ICoreWebView2Settings3, (void **)&s3))) {
            ICoreWebView2Settings3_put_AreBrowserAcceleratorKeysEnabled(s3, FALSE); /* no F5, Ctrl+P, browser find… */
            ICoreWebView2Settings3_Release(s3);
        }
        ICoreWebView2Settings_Release(s);
    }
    wchar_t boot[200];
    swprintf(boot, 200, L"window.__MP_DESKTOP={v:'%ls',os:'windows',mica:%d,micaok:%d};", APP_VERSION, g_mica, g_mica_ok);
    ICoreWebView2_AddScriptToExecuteOnDocumentCreated(web, boot, NULL);
    EventRegistrationToken tok;
    ICoreWebView2_add_WebMessageReceived(web, (ICoreWebView2WebMessageReceivedEventHandler *)&h_message, &tok);
    ICoreWebView2_add_NewWindowRequested(web, (ICoreWebView2NewWindowRequestedEventHandler *)&h_new_window, &tok);
    ICoreWebView2_add_NavigationStarting(web, (ICoreWebView2NavigationStartingEventHandler *)&h_navigating, &tok);
    ICoreWebView2_add_NavigationCompleted(web, (ICoreWebView2NavigationCompletedEventHandler *)&h_navigated, &tok);
    ICoreWebView2_add_PermissionRequested(web, (ICoreWebView2PermissionRequestedEventHandler *)&h_permission, &tok);
}

static HRESULT STDMETHODCALLTYPE on_controller(void *self, HRESULT err, ICoreWebView2Controller *ctl) {
    (void)self;
    if (FAILED(err) || !ctl) return S_OK;
    g_ctl = ctl;
    ICoreWebView2Controller_AddRef(g_ctl);
    ICoreWebView2Controller_get_CoreWebView2(g_ctl, &g_web);
    setup_web(g_ctl, g_web);
    resize_web();
    set_visible(IsWindowVisible(g_wnd) && !IsIconic(g_wnd));
    ICoreWebView2_Navigate(g_web, g_url);
    SetTimer(g_wnd, T_TICK, 15000, NULL);
    SetTimer(g_wnd, T_PRESENCE, 60000, NULL);
    return S_OK;
}
HANDLER(h_controller, on_controller);

/* ------------------------------------------------------------------ a chat in its own window
 *
 * «باز کردن در پنجره جدا» in the chat (or the page's {t:"popout"}): a small window of its own with just that
 * conversation (the chat page with ?pop=ID), sharing the main window's browser profile and sign-in. Opening the
 * same chat again brings its window forward. Up to 16 at a time. */
typedef struct Pop { HWND wnd; ICoreWebView2Controller *ctl; ICoreWebView2 *web; int channel, pending; wchar_t url[1200]; } Pop;
static Pop g_pops[16];
typedef struct { HandlerVtbl *vtbl; LONG ref; int idx; } PopHandler;

static Pop *pop_of(HWND h) { for (int i = 0; i < 16; i++) if (h && g_pops[i].wnd == h) return &g_pops[i]; return NULL; }
static HWND pop_window(ICoreWebView2 *web) { for (int i = 0; i < 16; i++) if (web && g_pops[i].web == web) return g_pops[i].wnd; return NULL; }

static HRESULT STDMETHODCALLTYPE on_pop_controller(void *self, HRESULT err, ICoreWebView2Controller *ctl) {
    Pop *p = &g_pops[((PopHandler *)self)->idx];
    p->pending = 0;
    if (FAILED(err) || !ctl || !p->wnd) return S_OK; /* closed before the browser was ready */
    p->ctl = ctl;
    ICoreWebView2Controller_AddRef(ctl);
    ICoreWebView2Controller_get_CoreWebView2(ctl, &p->web);
    setup_web(ctl, p->web);
    RECT rc;
    GetClientRect(p->wnd, &rc);
    ICoreWebView2Controller_put_Bounds(ctl, rc);
    ICoreWebView2Controller_put_IsVisible(ctl, TRUE);
    ICoreWebView2_Navigate(p->web, p->url);
    ICoreWebView2Controller_MoveFocus(ctl, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    return S_OK;
}
static HandlerVtbl pop_ctl_vtbl = { (void *)h_qi, (void *)h_addref, (void *)h_release, (void *)on_pop_controller };
static PopHandler g_pop_handlers[16];

/** The title bar in the page's colours (Windows 11 paints the caption; Windows 10 gets dark or light). */
static void dark_frame(HWND w) {
    BOOL dark = g_dark ? TRUE : FALSE;
    DwmSetWindowAttribute(w, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof(dark));
    DwmSetWindowAttribute(w, 35 /* DWMWA_CAPTION_COLOR (Windows 11) */, &g_bg, sizeof(g_bg));
    DwmSetWindowAttribute(w, 36 /* DWMWA_TEXT_COLOR */, &g_ink, sizeof(g_ink));
    COLORREF edge = mix(g_bg, g_ink, 12);
    DwmSetWindowAttribute(w, 34 /* DWMWA_BORDER_COLOR (Windows 11) */, &edge, sizeof(edge));
}

static void web_colour(ICoreWebView2Controller *ctl) {
    ICoreWebView2Controller2 *c2 = NULL;
    if (ctl && SUCCEEDED(ICoreWebView2Controller_QueryInterface(ctl, &IID_ICoreWebView2Controller2, (void **)&c2))) {
        COREWEBVIEW2_COLOR bg = { g_mica ? 0 : 255, GetRValue(g_bg), GetGValue(g_bg), GetBValue(g_bg) }; /* Mica: see-through */
        ICoreWebView2Controller2_put_DefaultBackgroundColor(c2, bg);
        ICoreWebView2Controller2_Release(c2);
    }
}

static int parse_hex(const wchar_t *h, COLORREF *out) {
    unsigned r, g, b;
    while (*h == L' ') h++;
    if (*h != L'#' || wcslen(h) < 7 || swscanf(h + 1, L"%2x%2x%2x", &r, &g, &b) != 3) return 0;
    *out = RGB(r, g, b);
    return 1;
}

/* {"t":"theme","dark":1,"bg":"#17212b","ink":"#f5f5f5"} from the page */
static void apply_theme(const wchar_t *j) {
    wchar_t bg[16], ink[16];
    json_str(j, L"bg", bg, 16);
    json_str(j, L"ink", ink, 16);
    COLORREF b = g_bg, i = g_ink;
    if (!parse_hex(bg, &b)) return;
    parse_hex(ink, &i);
    g_bg = b; g_ink = i; g_dark = (int)json_num(j, L"dark", 1) != 0;
    reg_set(L"bg", (DWORD)g_bg); reg_set(L"ink", (DWORD)g_ink); reg_set(L"dark", (DWORD)g_dark);
    if (g_bg_brush) DeleteObject(g_bg_brush);
    g_bg_brush = CreateSolidBrush(g_bg);
    dark_frame(g_wnd);
    web_colour(g_ctl);
    InvalidateRect(g_wnd, NULL, TRUE);
    for (int k = 0; k < 16; k++) if (g_pops[k].wnd) { dark_frame(g_pops[k].wnd); web_colour(g_pops[k].ctl); }
}

/* {"t":"zoom","v":1.25}: the whole window scales, like Telegram's interface scale */
static void apply_zoom(double z) {
    if (z < 0.8 || z > 2.0) return;
    g_zoom = z;
    reg_set(L"zoom", (DWORD)(z * 100 + 0.5));
    if (g_ctl) ICoreWebView2Controller_put_ZoomFactor(g_ctl, z);
    for (int k = 0; k < 16; k++) if (g_pops[k].ctl) ICoreWebView2Controller_put_ZoomFactor(g_pops[k].ctl, z);
}

static void open_pop(int channel, const wchar_t *title) {
    if (!g_env || channel <= 0) return;
    for (int i = 0; i < 16; i++)
        if (g_pops[i].wnd && g_pops[i].channel == channel) {
            if (IsIconic(g_pops[i].wnd)) ShowWindow(g_pops[i].wnd, SW_RESTORE);
            SetForegroundWindow(g_pops[i].wnd);
            return;
        }
    int i = 0;
    while (i < 16 && (g_pops[i].wnd || g_pops[i].pending)) i++;
    if (i == 16) return;
    Pop *p = &g_pops[i];
    memset(p, 0, sizeof(*p));
    p->channel = channel;
    swprintf(p->url, 1200, L"%ls%lspop=%d#chat-%d", g_url, wcschr(g_url, L'?') ? L"&" : L"?", channel, channel);
    wchar_t caption[200] = L"";
    if (title && *title) { lstrcpynW(caption, title, 120); lstrcatW(caption, L" \x2014 "); }
    lstrcatW(caption, APP_NAME);
    /* beside the main window, each new one a little lower */
    UINT dpi = GetDpiForWindow(g_wnd);
    int w = MulDiv(480, dpi ? dpi : 96, 96), hgt = MulDiv(760, dpi ? dpi : 96, 96);
    RECT mr, wa;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);
    GetWindowRect(g_wnd, &mr);
    int x = IsWindowVisible(g_wnd) ? mr.left - w / 2 + i * 28 : wa.right - w - 40 - i * 28, y = (IsWindowVisible(g_wnd) ? mr.top : wa.top + 40) + i * 28;
    if (x < wa.left) x = wa.left + 8;
    if (x + w > wa.right) x = wa.right - w - 8;
    if (y + hgt > wa.bottom) hgt = wa.bottom - y - 8;
    p->wnd = CreateWindowExW(WS_EX_APPWINDOW, POP_CLASS, caption, WS_OVERLAPPEDWINDOW, x, y, w, hgt, NULL, NULL, g_inst, NULL);
    if (!p->wnd) return;
    dark_frame(p->wnd);
    ShowWindow(p->wnd, SW_SHOWNORMAL);
    SetForegroundWindow(p->wnd);
    g_pop_handlers[i].vtbl = &pop_ctl_vtbl;
    g_pop_handlers[i].ref = 1;
    g_pop_handlers[i].idx = i;
    p->pending = 1;
    if (FAILED(ICoreWebView2Environment_CreateCoreWebView2Controller(g_env, p->wnd, (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *)&g_pop_handlers[i]))) p->pending = 0;
}

static LRESULT CALLBACK pop_proc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
    Pop *p = pop_of(h);
    switch (msg) {
    case WM_ERASEBKGND: {
        RECT rc; GetClientRect(h, &rc);
        FillRect((HDC)wp, &rc, g_bg_brush ? g_bg_brush : (HBRUSH)GetStockObject(BLACK_BRUSH));
        return 1;
    }
    case WM_SIZE:
        if (p && p->ctl) {
            RECT rc;
            GetClientRect(h, &rc);
            ICoreWebView2Controller_put_Bounds(p->ctl, rc);
            ICoreWebView2Controller_put_IsVisible(p->ctl, wp != SIZE_MINIMIZED);
        }
        return 0;
    case WM_MOVE:
        if (p && p->ctl) ICoreWebView2Controller_NotifyParentWindowPositionChanged(p->ctl);
        return 0;
    case WM_ACTIVATE:
        if (LOWORD(wp) != WA_INACTIVE && p && p->ctl) ICoreWebView2Controller_MoveFocus(p->ctl, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        return 0;
    case WM_GETMINMAXINFO: {
        MINMAXINFO *mm = (MINMAXINFO *)lp;
        mm->ptMinTrackSize.x = 340; mm->ptMinTrackSize.y = 420;
        return 0;
    }
    case WM_TIMER:
        if (wp == T_RETRY) { KillTimer(h, T_RETRY); if (p && p->web) ICoreWebView2_Navigate(p->web, p->url); }
        return 0;
    case WM_DESTROY:
        if (p) {
            if (p->ctl) { ICoreWebView2Controller_Close(p->ctl); ICoreWebView2Controller_Release(p->ctl); }
            if (p->web) ICoreWebView2_Release(p->web);
            p->ctl = NULL; p->web = NULL; p->wnd = NULL; p->channel = 0;
        }
        return 0;
    }
    return DefWindowProcW(h, msg, wp, lp);
}

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
    /* the chat keeps full speed while hidden beside the clock (news and notifications at once, like Telegram) */
    SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", L"--disable-background-timer-throttling --disable-renderer-backgrounding");
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

/* ECDSA P-256 / SHA-256: is sighex (r||s, 128 hex digits) a signature of data by UPDATE_KEY? */
static int verify_update(const BYTE *data, DWORD len, const char *sighex) {
    BYTE sig[64], hash[32];
    for (int i = 0; i < 64; i++) {
        unsigned v;
        if (!sighex[i * 2] || !sighex[i * 2 + 1] || sscanf(sighex + i * 2, "%2x", &v) != 1) return 0;
        sig[i] = (BYTE)v;
    }
    int ok = 0;
    BCRYPT_ALG_HANDLE ha = NULL, ea = NULL;
    BCRYPT_HASH_HANDLE hh = NULL;
    BCRYPT_KEY_HANDLE key = NULL;
    if (BCryptOpenAlgorithmProvider(&ha, BCRYPT_SHA256_ALGORITHM, NULL, 0) == 0 &&
        BCryptCreateHash(ha, &hh, NULL, 0, NULL, 0, 0) == 0 &&
        BCryptHashData(hh, (PUCHAR)data, len, 0) == 0 &&
        BCryptFinishHash(hh, hash, 32, 0) == 0 &&
        BCryptOpenAlgorithmProvider(&ea, BCRYPT_ECDSA_P256_ALGORITHM, NULL, 0) == 0 &&
        BCryptImportKeyPair(ea, NULL, BCRYPT_ECCPUBLIC_BLOB, &key, (PUCHAR)UPDATE_KEY, sizeof(UPDATE_KEY), 0) == 0)
        ok = BCryptVerifySignature(key, NULL, hash, 32, sig, 64, 0) == 0;
    if (key) BCryptDestroyKey(key);
    if (hh) BCryptDestroyHash(hh);
    if (ha) BCryptCloseAlgorithmProvider(ha, 0);
    if (ea) BCryptCloseAlgorithmProvider(ea, 0);
    return ok;
}

static BYTE *read_all(const wchar_t *path, DWORD *len) {
    HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return NULL;
    DWORD size = GetFileSize(f, NULL), got = 0;
    BYTE *b = size && size < 64 * 1024 * 1024 ? (BYTE *)HeapAlloc(GetProcessHeap(), 0, size + 1) : NULL;
    if (b && (!ReadFile(f, b, size, &got, NULL) || got != size)) { HeapFree(GetProcessHeap(), 0, b); b = NULL; }
    CloseHandle(f);
    if (b) { b[size] = 0; *len = size; }
    return b;
}

/*
 * Updates from the site, signed: the new program is downloaded exactly as it was built (&raw=1) together with its
 * signature (&sig=1), checked against the public key built into this program, and only then given this
 * installation's site address (written into the copy, as the panel does on download) and swapped in. A hacked site
 * cannot push a program of its own: the private key never leaves the build (apps/, not in the plugin).
 */
#ifdef UPD_DEBUG /* test builds: what the update did, in C:\upd.log */
#define UDBG(...) do { FILE *lf = fopen("C:\\upd.log", "a"); if (lf) { fprintf(lf, __VA_ARGS__); fputc('\n', lf); fclose(lf); } } while (0)
#else
#define UDBG(...) do { } while (0)
#endif
static DWORD WINAPI update_thread(LPVOID unused) {
    (void)unused;
    wchar_t info[1300], tmp[MAX_PATH], next[MAX_PATH], old[MAX_PATH], dl[1300], sigf[MAX_PATH];
    const wchar_t *sep = wcschr(g_url, L'?') ? L"&" : L"?";
    swprintf(info, 1300, L"%ls%lsrest_route=/moraba-panel/v1/app/info&_=%llu", g_url, sep, (unsigned long long)GetTickCount64());
    swprintf(tmp, MAX_PATH, L"%ls\\update.json", g_home);
    if (FAILED(URLDownloadToFileW(NULL, info, tmp, 0, NULL))) { UDBG("info download failed"); return 0; }
    DWORD got = 0;
    BYTE *jb = read_all(tmp, &got);
    DeleteFileW(tmp);
    if (!jb) return 0;
    char *v = strstr((char *)jb, "\"desktop\":\"");
    wchar_t ver[32] = { 0 };
    if (v) { v += 11; for (int i = 0; i < 31 && v[i] && v[i] != '"'; i++) ver[i] = (wchar_t)v[i]; }
    HeapFree(GetProcessHeap(), 0, jb);
    UDBG("site has %ls", ver);
    if (!ver[0] || !newer(ver, APP_VERSION) || (g_updated && !newer(ver, g_new_version))) return 0;
    /* the signature */
    swprintf(dl, 1300, L"%ls%lsmp_chat_exe=%ls&sig=1&_=%llu", g_url, sep, ver, (unsigned long long)GetTickCount64());
    swprintf(sigf, MAX_PATH, L"%ls\\update.sig", g_home);
    if (FAILED(URLDownloadToFileW(NULL, dl, sigf, 0, NULL))) return 0;
    BYTE *sig = read_all(sigf, &got);
    DeleteFileW(sigf);
    if (!sig) return 0;
    /* the program as built */
    swprintf(dl, 1300, L"%ls%lsmp_chat_exe=%ls&raw=1&_=%llu", g_url, sep, ver, (unsigned long long)GetTickCount64());
    swprintf(next, MAX_PATH, L"%ls\\MorabaChat.new.exe", g_home);
    if (FAILED(URLDownloadToFileW(NULL, dl, next, 0, NULL))) { HeapFree(GetProcessHeap(), 0, sig); return 0; }
    DWORD len = 0;
    BYTE *exe = read_all(next, &len);
    DeleteFileW(next);
    int good = exe && len > 100000 && exe[0] == 'M' && exe[1] == 'Z' && verify_update(exe, len, (const char *)sig);
    HeapFree(GetProcessHeap(), 0, sig);
    UDBG("downloaded %lu bytes, signature %s", (unsigned long)len, good ? "good" : "BAD");
    if (!good) { if (exe) HeapFree(GetProcessHeap(), 0, exe); return 0; }
    /* this installation's address goes into the new copy (where the build left the placeholder) */
    /* the placeholder, put together here so that its text appears only once in the program (in SITE_URL) */
    wchar_t mark[] = L"##MORABA_CHAT_URL##";
    mark[0] = mark[1] = mark[17] = mark[18] = L'@';
    DWORD mlen = (DWORD)(wcslen(mark) * sizeof(wchar_t));
    for (DWORD i = 0; i + 600 <= len; i++) {
        if (memcmp(exe + i, mark, mlen) == 0) {
            wchar_t addr[300] = { 0 };
            for (int k = 0; k < 299 && SITE_URL[k]; k++) addr[k] = SITE_URL[k];
            if (addr[0] != L'h') lstrcpynW(addr, g_url, 300); /* a development copy: the address in use */
            memcpy(exe + i, addr, 600);
            break;
        }
    }
    HANDLE f = CreateFileW(next, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    DWORD w = 0;
    int written = f != INVALID_HANDLE_VALUE && WriteFile(f, exe, len, &w, NULL) && w == len;
    if (f != INVALID_HANDLE_VALUE) CloseHandle(f);
    HeapFree(GetProcessHeap(), 0, exe);
    if (!written) { DeleteFileW(next); return 0; }
    /* swap: the running copy may be renamed, not overwritten */
    swprintf(old, MAX_PATH, L"%ls\\MorabaChat.old.exe", g_home);
    DeleteFileW(old);
    if (!MoveFileExW(g_self, old, MOVEFILE_REPLACE_EXISTING)) { DeleteFileW(next); return 0; }
    if (!MoveFileExW(next, g_self, MOVEFILE_REPLACE_EXISTING)) { MoveFileExW(old, g_self, MOVEFILE_REPLACE_EXISTING); return 0; }
    wcsncpy(g_new_version, ver, 31);
    UDBG("swapped in %ls", ver);
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
    case WM_ERASEBKGND: { /* the theme's colour while the page is not drawn yet (Mica: black = see-through) */
        RECT rc; GetClientRect(h, &rc);
        FillRect((HDC)wp, &rc, g_mica ? (HBRUSH)GetStockObject(BLACK_BRUSH) : g_bg_brush ? g_bg_brush : (HBRUSH)GetStockObject(BLACK_BRUSH));
        return 1;
    }
    case WM_NCCALCSIZE:
        if (g_custom && wp) {
            NCCALCSIZE_PARAMS *np = (NCCALCSIZE_PARAMS *)lp;
            LONG top = np->rgrc[0].top;
            LRESULT r = DefWindowProcW(h, msg, wp, lp);
            np->rgrc[0].top = top; /* no caption; the side and bottom borders stay */
            if (IsZoomed(h)) np->rgrc[0].top += frame_y(h); /* maximised: the frame hangs off the screen */
            return r;
        }
        break;
    case WM_NCHITTEST:
        if (g_custom) {
            LRESULT r = DefWindowProcW(h, msg, wp, lp);
            if (r == HTCLIENT) { LRESULT t = title_hit(h, lp); if (t != HTNOWHERE) return t; }
            return r;
        }
        break;
    case WM_PAINT:
        if (g_custom) { PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); paint_title(dc); EndPaint(h, &ps); return 0; }
        break;
    case WM_NCMOUSEMOVE:
        if (g_custom) {
            int hot = (wp == HTMINBUTTON || wp == HTMAXBUTTON || wp == HTCLOSE) ? (int)wp : 0;
            if (hot != g_hot) { g_hot = hot; invalidate_title(); }
            TRACKMOUSEEVENT tme = { sizeof(tme), TME_LEAVE | TME_NONCLIENT, h, 0 };
            TrackMouseEvent(&tme);
        }
        break;
    case WM_NCMOUSELEAVE:
        if (g_custom && (g_hot || g_pressed)) { g_hot = g_pressed = 0; invalidate_title(); }
        break;
    case WM_NCLBUTTONDOWN: case WM_NCLBUTTONDBLCLK:
        if (g_custom && (wp == HTMINBUTTON || wp == HTMAXBUTTON || wp == HTCLOSE)) { g_pressed = (int)wp; invalidate_title(); return 0; }
        break;
    case WM_NCLBUTTONUP:
        if (g_custom && (wp == HTMINBUTTON || wp == HTMAXBUTTON || wp == HTCLOSE)) {
            int was = g_pressed;
            g_pressed = 0;
            invalidate_title();
            if (was == (int)wp) {
                if (wp == HTMINBUTTON) ShowWindow(h, SW_MINIMIZE);
                else if (wp == HTMAXBUTTON) ShowWindow(h, IsZoomed(h) ? SW_RESTORE : SW_MAXIMIZE);
                else PostMessageW(h, WM_CLOSE, 0, 0);
            }
            return 0;
        }
        break;
    case WM_DPICHANGED: {
        RECT *r = (RECT *)lp;
        SetWindowPos(h, NULL, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_SETTEXT: {
        LRESULT r = DefWindowProcW(h, msg, wp, lp);
        invalidate_title();
        return r;
    }
    case WM_SIZE:
        resize_web();
        if (g_custom) InvalidateRect(h, NULL, FALSE);
        set_visible(wp != SIZE_MINIMIZED && IsWindowVisible(h));
        return 0;
    case WM_MOVE:
        if (g_ctl) ICoreWebView2Controller_NotifyParentWindowPositionChanged(g_ctl);
        return 0;
    case WM_ACTIVATE: {
        int on = LOWORD(wp) != WA_INACTIVE;
        if (on != g_focused) {
            g_focused = on;
            invalidate_title();
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
        else if (wp == T_PRESENCE) activity(L"tick");
        else if (wp == T_MEMORY) { KillTimer(h, T_MEMORY); if (!IsWindowVisible(h)) memory_level(1); }
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
        case ID_SNIP: snip(); break;
        case ID_RESTART: restart(); break;
        case ID_EXIT: g_quitting = 1; if (IsWindowVisible(h)) save_placement(); DestroyWindow(h); break;
        }
        tray_tip();
        g_nid.uFlags = NIF_TIP | NIF_SHOWTIP;
        Shell_NotifyIconW(NIM_MODIFY, &g_nid);
        return 0;
    case WM_CLIPBOARDUPDATE:
        if (g_snip_until && GetTickCount64() < g_snip_until) {
            if (IsClipboardFormatAvailable(CF_DIB) || IsClipboardFormatAvailable(CF_DIBV5)) {
                g_snip_until = 0;
                RemoveClipboardFormatListener(h);
                show_window();
                post_json(L"{\"t\":\"clip\"}");
            }
        } else if (g_snip_until) { g_snip_until = 0; RemoveClipboardFormatListener(h); }
        return 0;
    case WM_TOAST:
        toast_action((wchar_t *)lp);
        HeapFree(GetProcessHeap(), 0, (void *)lp);
        return 0;
    case WM_WTSSESSION_CHANGE:
        if (wp == WTS_SESSION_LOCK) { g_locked = 1; activity(L"lock"); }
        else if (wp == WTS_SESSION_UNLOCK) { g_locked = 0; activity(L"unlock"); }
        return 0;
    case WM_POWERBROADCAST:
        if (wp == PBT_APMSUSPEND) activity(L"sleep");
        else if (wp == PBT_APMRESUMESUSPEND || wp == PBT_APMRESUMEAUTOMATIC) { g_locked = 0; activity(L"wake"); }
        return TRUE;
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
        activity(L"end"); /* signing out or shutting down: work ends at the last input */
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
        WTSUnRegisterSessionNotification(h);
        for (int i = 0; i < 16; i++) if (g_pops[i].wnd) DestroyWindow(g_pops[i].wnd);
        if (g_ctl) ICoreWebView2Controller_Close(g_ctl);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, msg, wp, lp);
}

/* ------------------------------------------------------------------ install + the old way (no WebView2) */

static void shortcut_args(const wchar_t *lnk, const wchar_t *target, const wchar_t *workdir, const wchar_t *args) {
    IShellLinkW *sl = NULL;
    if (FAILED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&sl))) return;
    IShellLinkW_SetPath(sl, target);
    if (args) IShellLinkW_SetArguments(sl, args);
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

static void shortcut(const wchar_t *lnk, const wchar_t *target, const wchar_t *workdir) { shortcut_args(lnk, target, workdir, NULL); }

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
    /* Explorer: right-click a file → «ارسال به» → «مربع چت» */
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_SENDTO | CSIDL_FLAG_CREATE, NULL, 0, folder))) { link_path(lnk, folder); shortcut_args(lnk, target, g_home, L"--share"); }
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

    g_bg = (COLORREF)reg_get(L"bg", RGB(0x16, 0x16, 0x16));
    g_ink = (COLORREF)reg_get(L"ink", RGB(0xEE, 0xEE, 0xEE));
    g_dark = (int)reg_get(L"dark", 1);
    g_zoom = reg_get(L"zoom", 100) / 100.0;
    if (g_zoom < 0.8 || g_zoom > 2.0) g_zoom = 1.0;
    g_bg_brush = CreateSolidBrush(g_bg);
    g_icon = (HICON)LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), 0);
    g_icon_sm = (HICON)LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
    WNDCLASSEXW wc = { sizeof(wc) };
    wc.lpfnWndProc = wnd_proc;
    wc.hInstance = inst;
    wc.hIcon = g_icon;
    wc.hIconSm = g_icon_sm;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = g_bg_brush;
    wc.lpszClassName = WND_CLASS;
    RegisterClassExW(&wc);
    wc.lpfnWndProc = pop_proc;
    wc.lpszClassName = POP_CLASS;
    RegisterClassExW(&wc);
    g_taskbar_msg = RegisterWindowMessageW(L"TaskbarButtonCreated");

    /* a comfortable first size; afterwards, where the person left it */
    int sw = GetSystemMetrics(SM_CXSCREEN), shh = GetSystemMetrics(SM_CYSCREEN);
    int w = sw > 1400 ? 1180 : sw * 85 / 100, hgt = shh > 900 ? 780 : shh * 85 / 100;
    g_wnd = CreateWindowExW(WS_EX_APPWINDOW, WND_CLASS, APP_NAME, WS_OVERLAPPEDWINDOW, (sw - w) / 2, (shh - hgt) / 2, w, hgt, NULL, NULL, inst, NULL);
    if (!g_wnd) return 1;
    dark_frame(g_wnd);
    if (!reg_get(L"sysframe", 0)) set_frame(1);
    {   /* Mica / Acrylic behind the window: Windows 11 22H2 (build 22621) and newer, when chosen in the settings */
        typedef LONG (WINAPI *RtlGetVersionFn)(OSVERSIONINFOW *);
        OSVERSIONINFOW vi = { sizeof(vi) };
        RtlGetVersionFn rgv = (RtlGetVersionFn)(void *)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion");
        g_mica_ok = rgv && rgv(&vi) == 0 && vi.dwBuildNumber >= 22621;
        g_mica = g_mica_ok && reg_get(L"mica", 0);
        if (g_mica) {
            int type = 3; /* DWMSBT_TRANSIENTWINDOW: acrylic, the frosted look */
            DwmSetWindowAttribute(g_wnd, 38 /* DWMWA_SYSTEMBACKDROP_TYPE */, &type, sizeof(type));
            MARGINS mg = { -1, -1, -1, -1 };
            DwmExtendFrameIntoClientArea(g_wnd, &mg);
            BufferedPaintInit();
        }
    }
    WTSRegisterSessionNotification(g_wnd, NOTIFY_FOR_THIS_SESSION); /* lock / unlock for attendance */
    device_id();

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
