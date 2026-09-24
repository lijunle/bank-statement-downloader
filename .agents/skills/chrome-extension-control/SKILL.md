---
name: chrome-extension-control
description: Control unpacked Chrome extensions over the Chrome DevTools Protocol by launching real Chrome directly with a persistent profile, connecting the pinned CLI to it, loading the extension, triggering its toolbar action, and inspecting extension pages, service workers, console output, and network activity.
---

# Chrome Extension Control

Three steps, in order. Each depends on the previous one.

1. **[Machine setup](#1-machine-setup)** — once per machine.
2. **[Launch the Chrome instance](#2-launch-the-chrome-instance)** — once per working session.
3. **[Operate the extension](#3-operate-the-extension)** — the actual work.

The workflow and its invariants are platform-independent. Platform-specific commands belong in
the reference subsection at the end of each step so another reference, such as macOS, can be
added without changing how the workflow is explained.

## 1. Machine setup

Do this once per machine, with the user's approval.

Google Chrome 149 or newer and a Node.js version supported by the pinned CLI must be installed.
This skill drives the real Chrome installation rather than a bundled browser, so that banks see
a genuine Chrome build and unpacked extensions can load over an existing DevTools Protocol
connection. Chrome versions before 149 cannot use the extension tools through `--browserUrl`;
update Chrome instead of falling back to having the CLI launch it over a pipe.

Install the pinned CLI, which replaces upstream's global-install instructions and keeps the CLI
and its bundled documentation on the version in the skill's `package.json` and
`package-lock.json`. Reinstall whenever those manifests change.

The CLI dependency belongs to this skill rather than the repository root. Run skill installation
from the repository root, then run later CLI commands from the directory containing this
`SKILL.md` or use the CLI's absolute path.

### Windows PowerShell reference

Verify Chrome, then install the skill-local dependency from the repository root:

```powershell
(Get-Item "C:\Program Files\Google\Chrome\Application\chrome.exe").VersionInfo.ProductVersion
npm ci --prefix .\.agents\skills\chrome-extension-control
```

## 2. Launch the Chrome instance

Launch Chrome directly and then connect the CLI daemon to its TCP DevTools endpoint. Do not let
`chrome-devtools` launch Chrome. Separating the browser and daemon lifecycles:

- avoids Puppeteer's default launch arguments;
- lets the user keep using the visible browser while the daemon disconnects or restarts;
- allows the user to see and control exactly which executable, profile, address, and port are in
  use.

Use a dedicated persistent profile. Chrome 136 and newer require a non-default profile for remote
debugging. Bind CDP to loopback and have the shell choose an unused random port to pass explicitly
to Chrome.

Do not infer profile ownership by parsing process command lines. First probe the endpoint recorded
in `DevToolsActivePort`; reuse it when it responds and its browser WebSocket path matches the
file. Otherwise remove the stale file, launch Chrome, and wait with a timeout for a new working
endpoint. Chrome's own process-singleton mechanism prevents two browser
instances from owning the same profile.

A visible browser is mandatory for bank work, which needs sign-in, CAPTCHA, consent, and
multi-factor prompts. The profile retains browser data but does not guarantee that authentication
will remain valid; ask the user to sign in again when needed.

Do not continue until all browser postconditions hold:

- `DevToolsActivePort` identifies the same browser as the DevTools version endpoint;
- the endpoint responds on loopback;
- a visible browser window exists.

Check the current CLI daemon before changing it. Reuse it when it already targets this browser
endpoint with the extension category enabled. Otherwise preserve it and create a session-scoped
daemon. Use the same session ID for all later commands and stop only that scoped daemon when work
ends. Never let a command start the daemon implicitly because it would lose the selected endpoint
and extension category.

Verify the daemon with both an ordinary page command and an extension command.
`No extensions installed` is valid before step 3 and proves that the browser-level extension API
is available.

### Windows PowerShell reference

The reference below reuses a working browser endpoint or launches Chrome and waits for a fresh
one, then connects a scoped CLI daemon. If `status` already reports the same browser URL and the
extension category, reuse that daemon and omit `--sessionId` from later commands.

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profile = "$HOME\.cache\Google\Chrome\bank-sync"
$chromeDevtools = ".\node_modules\.bin\chrome-devtools.cmd"
$portFile = Join-Path $profile "DevToolsActivePort"

function Get-ActiveBrowserUrl {
  if (-not (Test-Path $portFile)) {
    return $null
  }

  $portFileContent = Get-Content $portFile
  if ($portFileContent.Count -lt 2 -or $portFileContent[0] -notmatch '^\d+$') {
    Write-Verbose "Ignoring an invalid DevToolsActivePort file."
    return $null
  }

  $candidate = "http://127.0.0.1:$($portFileContent[0])"
  try {
    $version = Invoke-RestMethod "$candidate/json/version" -TimeoutSec 2
  } catch {
    Write-Verbose "Ignoring a stale DevTools endpoint: $($_.Exception.Message)"
    return $null
  }

  if (([uri]$version.webSocketDebuggerUrl).PathAndQuery -ne $portFileContent[1]) {
    Write-Verbose "Ignoring a DevTools endpoint for a different browser."
    return $null
  }

  return $candidate
}

$reuseDeadline = (Get-Date).AddSeconds(5)
do {
  $browserUrl = Get-ActiveBrowserUrl
  if (-not $browserUrl -and (Test-Path $portFile)) {
    Start-Sleep -Milliseconds 250
  }
} while (-not $browserUrl -and (Test-Path $portFile) -and (Get-Date) -lt $reuseDeadline)

if (-not $browserUrl) {
  Remove-Item $portFile -Force -ErrorAction SilentlyContinue

  $usedPorts = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port
  do {
    $port = Get-Random -Minimum 49152 -Maximum 65536
  } while ($port -in $usedPorts)

  & $chrome `
    --remote-debugging-address=127.0.0.1 `
    "--remote-debugging-port=$port" `
    "--user-data-dir=$profile"

  $deadline = (Get-Date).AddSeconds(20)
  do {
    try {
      $version = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2
    } catch {
      Write-Verbose "Waiting for Chrome's DevTools endpoint: $($_.Exception.Message)"
      $version = $null
    }
    if ($version) {
      @("$port", ([uri]$version.webSocketDebuggerUrl).PathAndQuery) |
        Set-Content $portFile -ErrorAction Stop
      $browserUrl = Get-ActiveBrowserUrl
    }
    if (-not $browserUrl) {
      Start-Sleep -Milliseconds 250
    }
  } while (-not $browserUrl -and (Get-Date) -lt $deadline)

  if (-not $browserUrl) {
    throw "Chrome did not expose a working DevTools endpoint."
  }
}

Invoke-RestMethod "$browserUrl/json/version" |
  Select-Object Browser, "Protocol-Version", webSocketDebuggerUrl

& $chromeDevtools status
$sessionId = [guid]::NewGuid().ToString()
& $chromeDevtools start `
  --browserUrl=$browserUrl `
  --categoryExtensions=true `
  --sessionId=$sessionId

& $chromeDevtools list_pages --sessionId=$sessionId
& $chromeDevtools list_extensions --sessionId=$sessionId
```

## 3. Operate the extension

The daemon from step 2 owns the client connection to the directly launched Chrome. There is no
separate connect command after `start --browserUrl=...`.

### Load the extension

Start every Chrome session by checking whether the unpacked extension is present, and install it
only when absent. The unpacked extension belongs to the running Chrome instance, not the CLI
daemon:

- Stopping and restarting the daemon leaves the extension installed while Chrome keeps running.
- Closing and restarting Chrome removes the unpacked extension even when the same profile is
  reused, so reconnect the daemon and run `install_extension` again.
- In the controlled restart test for this extension, reinstalling from the same absolute path
  returned the same ID and restored its existing `chrome.storage.local` data.

These behaviors were verified by controlled restarts with a temporary storage marker that was
removed after the test. Never infer extension state from the daemon lifecycle or an earlier
successful command; verify it with `list_extensions`.

The install path is the directory containing `manifest.json`. Chrome assigns the extension ID
when it loads the extension. A manifest
[`key`](https://developer.chrome.com/docs/extensions/reference/manifest/key) maintains a
consistent ID during development, while an unpacked extension without a key can depend on its
path. Capture the ID returned by every `install_extension` call and confirm it with
`list_extensions`; never infer it from the path.

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
  `list_console_messages <pageId> --serviceWorkerId "<id>"`. The pinned CLI still requires
  the positional page ID for console listing, even with a worker filter. Service workers stop
  when idle and restart on demand, so re-run `list_pages` for a current ID rather than reusing
  a stale one.
- `evaluate_script --pageId` runs in the host page's main world, a different world from a content
  script. Observe content scripts indirectly: `list_console_messages <pageId>` includes their
  messages, `list_network_requests <pageId>` shows their requests, and `take_snapshot <pageId>`
  shows DOM they rendered. Requests from the extension's own service worker belong to the
  service-worker target instead.

### Keep page and popup state current

- Work in short inspect-act-verify steps. A successful click does not establish that navigation,
  data loading, or a filter change has finished. Wait with a bounded timeout for the expected
  page, selected value, enabled control, or resolved loading state before reading dependent data.
- A toolbar popup is ephemeral: it can close between commands. If its target disappears, use
  `list_pages`, select the intended bank tab, trigger the toolbar action again, and obtain the
  new popup ID and a fresh snapshot. Do not reuse old popup IDs or element UIDs, and do not
  reopen the popup as an ordinary tab to keep it alive.
- Reinspect controls after navigation or a rerender. Snapshot roles describe accessibility
  semantics, not necessarily HTML tags: a reported button may be a `div` with `role="button"`.
  Prefer snapshot UIDs for actions; inspect the actual markup before constructing DOM selectors.
- For a native select, the pinned `fill` command matches the option's displayed text, not its
  underlying HTML `value`. Confirm the selected option afterward. Changing an account or year
  can reset other filters and collapse document groups, so recheck and reopen the intended group.
- Scope extraction to that selected account, year, and document group. Do not collect every date
  from `document.body`: summaries, letters, tax documents, and other accounts can share the page.
  Where present, a group's `aria-controls` identifies its content container. Keep bank-specific
  labels, selectors, and category meanings in that bank's analysis rather than in this skill.
- If a popup disappears after a download click, inspect the browser/local download state before
  retrying. Failure to inspect the popup does not prove that the download failed, and another
  click may create a duplicate.

These are operating tips, not acceptance criteria. Use the
[Extension Validation Workflow](../../../docs/extension-validation.md) to decide which checks
to perform and how to report their results.

### Handle tool results and saved files

- Check the command's exit status **and** its returned result before consuming it. In the pinned
  CLI, some tool errors are printed with a zero process exit code. A wrapper must not turn a
  missing result into an empty list or proceed as though a failed selection succeeded.
- Keep stdout and stderr available for diagnosis, but sanitize them before reporting: tool errors
  can contain account labels, request URLs, and local filenames. A generic "evaluation failed"
  message that discards the underlying error makes recovery unnecessarily difficult.
- Do not assume `--output-format=json` produces one universal result schema. The pinned CLI can
  return structured content or an array of text chunks, including error text. Check the expected
  shape for the command instead of blindly parsing a Markdown code fence or trusting JSON alone.
- `get_network_request --responseFilePath` saves a `.network-response` file; a requested `.json`
  suffix may be replaced. Use the path reported by the tool and confirm that it exists. Inspect
  saved response bodies privately; do not copy raw captures or document payloads into the repo.
- The pinned navigation tools reject `chrome:` URLs, including `chrome://downloads/`. Do not
  repeatedly retry them. Use the browser's visible download UI or a local before/after file
  inventory to correlate a completed download, as described in the validation workflow.

### Windows PowerShell reference

The examples use the scoped daemon created in step 2. Omit `--sessionId` when reusing the
compatible default daemon. The extension path must be the directory containing `manifest.json`.

```powershell
& $chromeDevtools list_extensions --sessionId=$sessionId
& $chromeDevtools install_extension "C:\absolute\path\to\extension" --sessionId=$sessionId
& $chromeDevtools reload_extension "<extension-id>" --sessionId=$sessionId
& $chromeDevtools trigger_extension_action "<extension-id>" --sessionId=$sessionId
& $chromeDevtools list_pages --sessionId=$sessionId
```

After `list_pages`, target an extension service worker with its current ID:

```powershell
& $chromeDevtools evaluate_script "() => 1" `
  --serviceWorkerId "<service-worker-id>" `
  --sessionId=$sessionId

& $chromeDevtools list_console_messages $bankPageId `
  --serviceWorkerId "<service-worker-id>" `
  --types error warn `
  --sessionId=$sessionId
```

`$bankPageId` and `$popupPageId` below refer to current IDs obtained from `list_pages`, not
persisted IDs from an earlier popup or daemon session. Pass array options as separate arguments,
for example `--types error warn` or `--resourceTypes xhr fetch document`, not comma-separated
strings such as `--types error,warn`.

For JavaScript containing quotes, invoke the pinned Node entry point directly to avoid the
Windows `.cmd` shim's extra quoting layer. From the skill directory:

```powershell
$chromeDevtoolsJs = ".\node_modules\chrome-devtools-mcp\build\src\bin\chrome-devtools.js"
& node $chromeDevtoolsJs evaluate_script '() => { const button = document.querySelector("#refresh-btn"); if (!button) throw new Error("Refresh control missing"); return {enabled: !button.disabled}; }' --pageId $popupPageId --sessionId=$sessionId
```

Keep the function argument on one line; a newline can break Windows command parsing and lose
later flags. Avoid nesting long JavaScript programs inside shell strings. For an existing script
that launches child processes, use an argument array without a shell and preserve both output
streams and the exit status. Consult `--help` for the pinned command before guessing arguments;
an update notification is not a reason to install a different CLI version mid-session.

When work ends, stop only the scoped daemon created for this workflow:

```powershell
& $chromeDevtools stop --sessionId=$sessionId
```

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
