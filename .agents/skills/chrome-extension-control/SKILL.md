---
name: chrome-extension-control
description: Control unpacked Chrome extensions over the Chrome DevTools Protocol by launching real Chrome directly with a persistent profile, connecting the pinned CLI to it, loading the extension, triggering its toolbar action, and inspecting extension pages, service workers, console output, and network activity.
---

# Chrome Extension Control

Three steps, in order. Each depends on the previous one.

1. **[Machine setup](#1-machine-setup)** — once per machine.
2. **[Launch the Chrome instance](#2-launch-the-chrome-instance)** — once per working session.
3. **[Operate the extension](#3-operate-the-extension)** — the actual work.

Except for the installation command below, examples run from the directory containing
this `SKILL.md`, not the repository root. Use
`./node_modules/.bin/chrome-devtools` in place of the bare `chrome-devtools` in upstream
examples, or the binary's absolute path from another directory. On Windows, call
`.\node_modules\.bin\chrome-devtools.cmd` from PowerShell, or use a Bash shell.

## 1. Machine setup

Do this once per machine, with the user's approval.

Google Chrome 149 or newer and a Node.js version supported by the pinned CLI must be installed.
This skill drives the real Chrome installation rather than a bundled browser, so that banks see
a genuine Chrome build and unpacked extensions can load over an existing DevTools Protocol
connection. Chrome versions before 149 cannot use the extension tools through `--browserUrl`;
update Chrome instead of falling back to having the CLI launch it over a pipe.

On Windows, verify the installed version before continuing:

```powershell
(Get-Item "C:\Program Files\Google\Chrome\Application\chrome.exe").VersionInfo.ProductVersion
```

Install the pinned CLI, which replaces upstream's global-install instructions and keeps the CLI
and its bundled documentation on the version in the skill's `package.json` and
`package-lock.json`. Run this command from the repository root:

```powershell
npm ci --prefix .\.agents\skills\chrome-extension-control
```

Re-run it whenever those manifests change. For the examples below, switch to the skill
directory, or use the CLI's absolute path; root dependencies do not provide this CLI.

## 2. Launch the Chrome instance

Launch Chrome directly, then point the CLI daemon at its TCP DevTools endpoint. Do not let
`chrome-devtools` launch Chrome. Keeping the browser lifecycle separate from the daemon:

- avoids Puppeteer's default launch arguments;
- lets the user keep using the visible browser while the daemon disconnects or restarts;
- allows the user to see and control exactly which executable, profile, address, and port are in
  use.

Use a dedicated persistent profile and bind CDP to loopback only. On Windows:

```powershell
$profile = "$HOME\.cache\Google\Chrome\bank-sync"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=127.0.0.1 `
  --remote-debugging-port=0 `
  "--user-data-dir=$profile"
```

Port `0` makes Chrome choose an available port instead of assuming that a fixed port is free. Chrome
writes the selected port to `DevToolsActivePort` in the profile directory. Chrome 136 and newer
require a non-default `--user-data-dir` for remote debugging; never bind the endpoint to a
non-loopback address.

Before launching, confirm that no Chrome process already owns the `bank-sync` profile. Chrome
refuses to open one profile in two browser instances.

```powershell
$profileOwner = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object {
    $_.CommandLine -match '--user-data-dir=(?:"[^"]*[\\/]bank-sync"|\S*[\\/]bank-sync)(?=[\s]|$)'
  }
if ($profileOwner) {
  throw "The bank-sync profile is already open."
}
```

The profile is created on first launch. Sign in to required sites while the browser is visible.
It retains browser data but does not guarantee that a bank session remains authenticated.
Unpacked extension installation is browser-session state and is handled in step 3.

A visible browser is mandatory for bank work, which needs sign-in, CAPTCHA, consent, and
multi-factor prompts.

### Verify Chrome

Read the allocated port after Chrome writes `DevToolsActivePort`, then verify the loopback
endpoint:

```powershell
$port = Get-Content (Join-Path $profile "DevToolsActivePort") -TotalCount 1
$browserUrl = "http://127.0.0.1:$port"
Invoke-RestMethod "$browserUrl/json/version" |
  Select-Object Browser, "Protocol-Version", webSocketDebuggerUrl
```

Also verify that the browser process uses the dedicated profile and owns a visible window:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object {
    $_.CommandLine -notmatch '--type=' -and
    $_.CommandLine -match '--user-data-dir=(?:"[^"]*[\\/]bank-sync"|\S*[\\/]bank-sync)(?=[\s]|$)'
  } |
  ForEach-Object { Get-Process -Id $_.ProcessId } |
  Select-Object Id, MainWindowTitle, MainWindowHandle
```

Match the `--user-data-dir` flag rather than a bare `bank-sync` substring, anchor the end of the
path, and exclude `--type=` processes. Chrome's own default arguments contain unrelated matches,
PowerShell's `-match` is case-insensitive, a plain `\b` would also match a sibling profile such
as `bank-sync-old`, and every child process inherits the profile path.

### Connect the CLI daemon

Check the current daemon before changing it:

```powershell
$chromeDevtools = ".\node_modules\.bin\chrome-devtools.cmd"
& $chromeDevtools status
```

Reuse it when its `--browser-url` matches `$browserUrl` and it has `--category-extensions`.
Otherwise leave it untouched and create a session-scoped daemon:

```powershell
$sessionId = [guid]::NewGuid().ToString()
& $chromeDevtools start `
  --browserUrl=$browserUrl `
  --categoryExtensions=true `
  --sessionId=$sessionId
```

Use that same `--sessionId` on every later command and stop only that scoped daemon when work
ends. Never let a command start the selected daemon implicitly: it would lose `$browserUrl` and
the extension category. The commands below show the scoped case; omit `--sessionId` when reusing
the compatible default daemon.

Verify both ordinary page access and the browser-level extension API:

```powershell
& $chromeDevtools list_pages --sessionId=$sessionId
& $chromeDevtools list_extensions --sessionId=$sessionId
```

`No extensions installed` is a valid result before step 3; it proves that the extension command
reached Chrome.

## 3. Operate the extension

The daemon from step 2 owns the client connection to the directly launched Chrome. There is no
separate connect command after `start --browserUrl=...`. When using a scoped daemon, include its
`--sessionId` on every command below.

### Load the extension

Start every Chrome session by checking whether the unpacked extension is present:

```sh
./node_modules/.bin/chrome-devtools list_extensions
./node_modules/.bin/chrome-devtools install_extension "/absolute/path/to/extension"
```

Install only when the extension is absent. The unpacked extension belongs to the running Chrome
instance, not the CLI daemon:

- Stopping and restarting the daemon leaves the extension installed while Chrome keeps running.
- Closing and restarting Chrome removes the unpacked extension even when the same profile is
  reused, so reconnect the daemon and run `install_extension` again.
- Reinstalling from the same absolute path restores the same extension ID and its existing
  `chrome.storage.local` data from the persistent profile.

These behaviors were verified by controlled restarts with a temporary storage marker that was
removed after the test. Never infer extension state from the daemon lifecycle or an earlier
successful command; verify it with `list_extensions`.

The install path is the directory containing `manifest.json`. The extension ID is derived from
that absolute path, so it is stable across restarts and reinstalls from the same path; re-read it
from `list_extensions` only when the path changes.

When an installed unpacked extension's sources change, connect the daemon and run
`reload_extension <id>`. This reloads the same path without changing the ID or requiring an
uninstall/install cycle. If `list_extensions` does not contain the ID, use `install_extension`
instead. Reopen an extension popup after reloading it, and reload existing host pages when changed
content scripts must be injected again.

### Drive it

The [pinned CLI reference](node_modules/chrome-devtools-mcp/skills/chrome-devtools-cli/SKILL.md)
documents the commands themselves, including its `## Extensions` section. Behavior it omits:

- Manifest-declared pages load as ordinary pages from the extension origin, via
  `new_page "chrome-extension://<id>/path/to/page.html"`, after which every page tool applies.
- `trigger_extension_action <id>` renders the popup against the browser state it would normally
  see, including the active tab. A popup opened directly as a tab instead sees that tab as
  active, which changes what the extension reads.
- `list_pages` includes extension service workers. Target them with
  `evaluate_script "() => 1" --serviceWorkerId "<id>"` and
  `list_console_messages --serviceWorkerId "<id>"`. Service workers stop when idle and restart on
  demand, so re-run `list_pages` for a current ID rather than reusing a stale one.
- `evaluate_script --pageId` runs in the host page's main world, a different world from a content
  script. Observe content scripts indirectly: `list_console_messages <pageId>` includes their
  messages, `list_network_requests <pageId>` shows their requests, and `take_snapshot <pageId>`
  shows DOM they rendered. Requests from the extension's own service worker belong to the
  service-worker target instead.
- `evaluate_script` takes the function as one positional argument. On Windows PowerShell, pass it
  on a single line; a newline breaks argument parsing, so the following flags are lost and the
  command fails.

## Working rules

- Verify the postcondition of each mutation before continuing. A zero exit code is not evidence
  that the extension loaded, reloaded, or reached the expected state.
- The profile contains private browser data such as cookies. Treat it as the user's data:
  do not copy it into a repository or move it between machines.
- [Chrome documents](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session)
  that `chrome.storage.session` is held in memory and clears when an extension is disabled,
  reloaded, or updated, and when the browser restarts.
- Keep credentials, cookies, tokens, and other values read out of a live session out of files and
  out of reports.
- Do not inject scripts or tune flags to conceal automation or bypass a bank's fraud controls.
- Ask before uninstalling an extension, clearing a profile, or closing a browser the user did not
  ask to be closed.
