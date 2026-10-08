/*
 * «مربع چت» for Windows: a small launcher, no installer needed.
 *
 * - The first run from anywhere (e.g. Downloads) copies itself to %LOCALAPPDATA%\MorabaChat, adds «مربع چت»
 *   to the Start menu and the desktop, then opens the chat. Later runs just open it.
 * - The chat opens as its own app window (no tabs, no address bar) in Microsoft Edge, which every Windows
 *   10/11 has; Chrome is used when Edge is missing, the default browser as a last resort. Its own profile
 *   keeps the sign-in, window size and notifications apart from the person's browsing.
 * - The site's address is written into the file when it is downloaded from the panel (PHP replaces the
 *   placeholder below), so the same build works for any site. A "site.txt" next to the copy wins over it.
 *
 * Build: apps/windows/build.sh (mingw-w64) → assets/app/MorabaChat.exe
 */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define COBJMACROS
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <objbase.h>
#include <propkey.h>
#include <wchar.h>

/* Replaced in the downloaded file by the site's chat address (UTF-16LE, the rest of the 300 characters NUL). */
static volatile const wchar_t SITE_URL[300] = L"@@MORABA_CHAT_URL@@";

#define APP_ID L"Moraba.Chat"
#define APP_NAME L"\x0645\x0631\x0628\x0639 \x0686\x062A" /* مربع چت */

static void dir_of(wchar_t *path) { wchar_t *s = wcsrchr(path, L'\\'); if (s) *s = 0; }

static int exists(const wchar_t *p) { DWORD a = GetFileAttributesW(p); return a != INVALID_FILE_ATTRIBUTES; }

/** The chat's address: site.txt beside the program, else the one written in at download. */
static void chat_url(wchar_t *out, size_t n, const wchar_t *home) {
    wchar_t txt[MAX_PATH];
    out[0] = 0;
    swprintf(txt, MAX_PATH, L"%ls\\site.txt", home);
    HANDLE f = CreateFileW(txt, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f != INVALID_HANDLE_VALUE) {
        char buf[1024]; DWORD got = 0;
        if (ReadFile(f, buf, sizeof(buf) - 1, &got, NULL) && got > 0) {
            buf[got] = 0;
            char *e = buf + strlen(buf);
            while (e > buf && (e[-1] == '\r' || e[-1] == '\n' || e[-1] == ' ')) *--e = 0;
            MultiByteToWideChar(CP_UTF8, 0, buf, -1, out, (int)n);
        }
        CloseHandle(f);
    }
    if (!out[0] || wcsncmp(out, L"http", 4) != 0) {
        size_t i = 0;
        for (; i + 1 < n && i < 299 && SITE_URL[i]; i++) out[i] = SITE_URL[i];
        out[i] = 0;
    }
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

/** A shortcut to the program, with its own app id so the taskbar groups its windows as «مربع چت». */
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
        size_t bytes = (wcslen(APP_ID) + 1) * sizeof(wchar_t);
        PropVariantInit(&pv);
        pv.vt = VT_LPWSTR;
        pv.pwszVal = (LPWSTR)CoTaskMemAlloc(bytes);
        if (pv.pwszVal) {
            memcpy(pv.pwszVal, APP_ID, bytes);
            IPropertyStore_SetValue(ps, &PKEY_AppUserModel_ID, &pv);
            IPropertyStore_Commit(ps);
            PropVariantClear(&pv);
        }
        IPropertyStore_Release(ps);
    }
    IPersistFile *pf = NULL;
    if (SUCCEEDED(IShellLinkW_QueryInterface(sl, &IID_IPersistFile, (void **)&pf))) {
        if (FAILED(IPersistFile_Save(pf, lnk, TRUE))) {
            // A file system that refuses the Persian name: «Moraba Chat.lnk» instead.
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

/** First run from elsewhere: keep a copy in %LOCALAPPDATA%\MorabaChat and add Start menu / desktop shortcuts. */
static void install(const wchar_t *self, wchar_t *home) {
    wchar_t local[MAX_PATH], target[MAX_PATH], lnk[MAX_PATH], folder[MAX_PATH];
    if (!GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH)) return;
    swprintf(home, MAX_PATH, L"%ls\\MorabaChat", local);
    CreateDirectoryW(home, NULL);
    swprintf(target, MAX_PATH, L"%ls\\MorabaChat.exe", home);
    if (lstrcmpiW(self, target) != 0) CopyFileW(self, target, FALSE); /* a newer download replaces the old copy */
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, folder))) {
        link_path(lnk, folder);
        shortcut(lnk, target, home);
    }
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, folder))) {
        link_path(lnk, folder);
        if (!exists(lnk)) shortcut(lnk, target, home);
    }
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, LPWSTR cmd, int show) {
    (void)inst; (void)prev; (void)cmd; (void)show;
    wchar_t self[MAX_PATH], home[MAX_PATH], url[1100], browser[MAX_PATH], args[2400], profile[MAX_PATH];
    GetModuleFileNameW(NULL, self, MAX_PATH);
    wcscpy(home, self);
    dir_of(home);
    SetCurrentProcessExplicitAppUserModelID(APP_ID);
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    install(self, home);
    CoUninitialize();
    chat_url(url, 1100, home);
    if (!url[0] || wcsncmp(url, L"http", 4) != 0) {
        MessageBoxW(NULL, L"\x0622\x062F\x0631\x0633 \x0633\x0627\x06CC\x062A \x062F\x0631 \x0627\x06CC\x0646 \x0641\x0627\x06CC\x0644 \x0646\x06CC\x0633\x062A\x061B \x0627\x067E \x0631\x0627 \x0627\x0632 \x067E\x0646\x0644 \x0645\x0631\x0628\x0639 \x062F\x0627\x0646\x0644\x0648\x062F \x06A9\x0646\x06CC\x062F.",
            APP_NAME, MB_ICONWARNING | MB_RTLREADING | MB_RIGHT);
        return 1;
    }
    swprintf(profile, MAX_PATH, L"%ls\\Profile", home);
    if (find_browser(browser)) {
        swprintf(args, 2400, L"\"%ls\" --app=\"%ls\" --user-data-dir=\"%ls\" --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2", browser, url, profile);
        STARTUPINFOW si; PROCESS_INFORMATION pi;
        ZeroMemory(&si, sizeof(si)); si.cb = sizeof(si);
        ZeroMemory(&pi, sizeof(pi));
        if (CreateProcessW(browser, args, NULL, NULL, FALSE, 0, NULL, home, &si, &pi)) {
            CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
            return 0;
        }
    }
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
    return 0;
}
