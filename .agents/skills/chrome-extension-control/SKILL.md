---
name: chrome-extension-control
description: Control of unpacked Chrome extensions over the Chrome DevTools Protocol, covering machine setup, launching a visible Chrome instance, loading the extension into a session, extension-owned pages, toolbar action triggering, extension service worker evaluation, and console and network inspection of extension activity.
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

Google Chrome and a Node.js version supported by the pinned CLI must be installed.
This skill uses the installed Chrome to load unpacked extensions over the DevTools Protocol.

Install the pinned CLI, which replaces upstream's global-install instructions and keeps the CLI
and its bundled documentation on the version in the skill's `package.json` and
`package-lock.json`. Run this command from the repository root:

```powershell
npm ci --prefix .\.agents\skills\chrome-extension-control
```

Re-run it whenever those manifests change. For the examples below, switch to the skill
directory, or use the CLI's absolute path; root dependencies do not provide this CLI.

No separate command creates the browser profile; step 2 creates it on first launch. After that
first launch, sign in to any site the profile needs while the browser is visible. The profile
can retain cookies, but sessions can expire or require MFA again. Verify authentication each
working session and ask the user to sign in when needed. Unpacked extensions loaded by this
tool do not persist this way, which is why loading the extension belongs to step 3.

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
  --ignoreDefaultChromeArg=--hide-scrollbars
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
- Removing `--hide-scrollbars` restores normal scrolling controls in the visible browser.
  Keep the default `--enable-automation` flag.

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

### Authentication and automation limits

Bank sites run bot detection. Expect commercial bot-management and device-fingerprinting
services, which read automation signals from the browser.

Visible mode does not make an automated browser indistinguishable from a manually launched
one. Leave `navigator.webdriver` and other automation signals unchanged; do not inject scripts
or tune flags to conceal automation. A persistent profile retains browser data, not a guarantee
of authentication or acceptance by a bank.

If a site rejects the automated session, report the workflow as blocked and ask the user to
take over or choose a supported access method. Do not retry with fingerprint overrides or
attempt to bypass the bank's fraud controls.

### Sharing the daemon

By default, CLI commands share one daemon, and `start` restarts it, replacing a daemon another
skill pointed at a different browser. Capture the current configuration with `status` before
restarting, and restore it afterwards when the previous session still matters.

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
- The profile contains private browser data such as cookies. Treat it as the user's data:
  do not copy it into a repository or move it between machines. This extension's
  `chrome.storage.session` cache is in memory and clears on browser restart or extension
  reload; it is not persisted in the profile directory.
- Keep credentials, cookies, tokens, and other values read out of a live session out of files and
  out of reports.
- Ask before uninstalling an extension, clearing a profile, or closing a browser the user did not
  ask to be closed.
