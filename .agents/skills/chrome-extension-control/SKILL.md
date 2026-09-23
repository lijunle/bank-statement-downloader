---
name: chrome-extension-control
description: Control of unpacked Chrome extensions over the Chrome DevTools Protocol, covering machine setup, launching a visible Chrome instance with automation flags removed, loading the extension into a session, extension-owned pages, toolbar action triggering, extension service worker evaluation, and console and network inspection of extension activity.
---

# Chrome Extension Control

Three steps, in order. Each depends on the previous one.

1. **[Machine setup](#1-machine-setup)** — once per machine.
2. **[Launch the Chrome instance](#2-launch-the-chrome-instance)** — once per working session.
3. **[Operate the extension](#3-operate-the-extension)** — the actual work.

Paths are relative to the directory containing this `SKILL.md`. Use
`./node_modules/.bin/chrome-devtools` in place of the bare `chrome-devtools` in upstream
examples, or the binary's absolute path from another directory. On Windows, call
`.\node_modules\.bin\chrome-devtools.cmd` from PowerShell, or use a Bash shell.

## 1. Machine setup

Do this once per machine, with the user's approval.

Google Chrome must be installed. This skill drives the real Chrome installation rather than a
bundled browser, so that banks see a genuine Chrome build and so that unpacked extensions load
over the DevTools Protocol.

Install the pinned CLI, which replaces upstream's global-install instructions and keeps the CLI
and its bundled documentation on the version in `package.json` and `package-lock.json`:

```sh
npm install
```

Re-run it whenever those manifests change.

No separate command creates the browser profile; step 2 creates it on first launch. After that
first launch, sign in to any site the profile needs while the browser is visible. Cookies and
sessions persist in the profile directory, so each sign-in is a one-time cost rather than a
per-run step. Unpacked extensions do not persist this way, which is why loading the extension
belongs to step 3.

## 2. Launch the Chrome instance

Extension tools require the daemon to launch Chrome itself over a pipe connection.
`--browserUrl`, `--wsEndpoint`, and `--autoConnect` do not support extension tools in the pinned
version, so an already-running Chrome cannot be adopted.

Start the daemon explicitly, before any other command:

```sh
./node_modules/.bin/chrome-devtools start \
  --categoryExtensions=true \
  --userDataDir "$HOME/.cache/Google/Chrome/bank-sync" \
  --ignoreDefaultChromeArg=--headless=new \
  --ignoreDefaultChromeArg=--hide-scrollbars \
  --ignoreDefaultChromeArg=--enable-automation
```

Why each part matters:

- `--categoryExtensions=true` enables every extension command used in step 3.
- `--userDataDir` keeps the profile, and its sign-in cookies, across restarts. Without it the
  daemon defaults to `--isolated` and discards everything when the browser closes.
- Removing `--headless=new` is what makes the browser visible. Upstream's `## Service Management`
  section recommends `start --headless=false`, but that does not work here: the pinned CLI
  silently drops both `--headless=false` and `--no-headless`, because the server-side default for
  `headless` is `false` while the CLI-side default is `true`, and the serializer skips any value
  equal to the server-side default. Removing Chrome's own argument is the supported path.
- Removing `--hide-scrollbars` and `--enable-automation` drops two automation fingerprints.

A visible browser is mandatory for bank work, which needs sign-in, CAPTCHA, consent, and
multi-factor prompts.

Never let a tool command start the daemon implicitly. An implicit start uses default options and
produces a headless browser.

### Trigger the launch and verify visibility

`start` only configures the daemon. Chrome does not launch until the first command arrives, so
issue one:

```sh
./node_modules/.bin/chrome-devtools list_pages
```

`status` reports `--headless` even when Chrome is visible, so it cannot confirm visibility. Check
the Chrome process instead, and do not continue until a window exists:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match '--user-data-dir=\S*[\\/]bank-sync(?=["\s]|$)' } |
  ForEach-Object { Get-Process -Id $_.ProcessId } |
  Select-Object Id, MainWindowTitle, MainWindowHandle
```

Match the `--user-data-dir` flag rather than a bare `bank-sync` substring, anchor the end of the
path, and exclude `--type=` processes. Chrome's own default arguments contain unrelated matches,
PowerShell's `-match` is case-insensitive, a plain `\b` would also match a sibling profile such
as `bank-sync-old`, and every child process inherits the profile path.

### Automation fingerprints

Bank sites run bot detection. Expect commercial bot-management and device-fingerprinting
services, which read automation signals from the browser.

Removing the flags above does not make the browser indistinguishable. `navigator.webdriver`
stays `true` because the CDP pipe connection sets it, not `--enable-automation`. Every CDP-based
tool has this property, so switching tools does not avoid it. Mask it per navigation:

```sh
./node_modules/.bin/chrome-devtools navigate_page <pageId> --url "https://example.com" \
  --initScript "Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });"
```

`--initScript` runs before page scripts, so it lands ahead of the detection sensor.

Reusing one persistent profile helps more than flag tuning: a stable device fingerprint with real
sign-in history looks less suspicious than a fresh profile on every run.

Stop at not advertising automation. Do not build further evasion of a bank's fraud controls.
Downloading your own statements is legitimate; defeating fraud detection is not, and it can get
the account flagged.

### Sharing the daemon

Only one daemon runs at a time, and `start` restarts it, replacing a daemon another skill pointed
at a different browser. Capture the current configuration with `status` before restarting, and
restore it afterwards when the previous session still matters.

Chrome refuses to open a profile directory that another Chrome process already has open. Keep
this profile directory distinct from every other automation or everyday profile on the machine.

## 3. Operate the extension

The daemon from step 2 is the connection; no separate connect command exists.

### Load the extension

Load it at the start of every session:

```sh
./node_modules/.bin/chrome-devtools install_extension "/abs/path/to/extension"
```

An unpacked extension loaded this way is **session state, not profile state**. A restarted daemon
reports `No extensions installed` even with the same `--userDataDir`. Confirm with
`list_extensions` rather than trusting the exit code.

The install path is the directory containing `manifest.json`. The extension ID is derived from
that absolute path, so it is stable across restarts and reinstalls from the same path; re-read it
from `list_extensions` only when the path changes.

Use `reload_extension <id>` after editing sources. It picks up changes without changing the ID.

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
- Extension state, storage, and sign-in cookies live in the profile directory. Treat that
  directory as the user's data: do not copy it into a repository, and do not move it between
  machines.
- Keep credentials, cookies, tokens, and other values read out of a live session out of files and
  out of reports.
- Ask before uninstalling an extension, clearing a profile, or closing a browser the user did not
  ask to be closed.
