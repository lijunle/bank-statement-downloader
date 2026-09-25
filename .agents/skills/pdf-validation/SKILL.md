---
name: pdf-validation
description: Provide independent local PDF capabilities to inspect metadata, check in-memory page rendering, or match supplied text on selected pages. Use these operations without exposing document contents or exporting images; callers define their own validation workflow.
---

# PDF Validation

Use [validate_pdf.py](validate_pdf.py) as a capability tool, not a prescribed
validation workflow:

| Operation | Capability | Not performed |
| --------- | ---------- | ------------- |
| `inspect` | Read PDF metadata, page count, password-protection state, and parser diagnostics. | Rendering and text matching. |
| `render` | Open the PDF and render every page in memory. | Text extraction and matching. |
| `match` | Open the PDF and locate supplied expected text on specified pages. | Rendering and visual inspection. |

Each operation is independently callable. The caller chooses which operations to
run, establishes the file's provenance, supplies expectations, and decides
acceptance criteria. The tool neither operates a browser nor chooses downloads,
and no individual command represents application end-to-end success.

The script reads the source without modifying it. It makes no network requests,
saves no images or extracted text, and emits one JSON object containing counts,
statuses, page numbers, and diagnostic codes, not filenames, expected strings,
extracted text, or raw parser messages. `--help` prints usage instead of JSON.

## Setup

Use Python 3.10 or newer with the exact dependency in
[requirements.txt](requirements.txt). Keep a dedicated virtual environment in
this skill's `.venv` directory and reuse it between documents. Do not install
into an application's dependency environment, automatically upgrade the pin, or
delete the environment after each check.

The PyMuPDF 1.28.2 pin includes MuPDF 1.28.2. Do not reuse an older installed
renderer after updating the requirements: MuPDF versions through 1.27.0 are
affected by [CVE-2026-3308](https://www.cve.org/CVERecord?id=CVE-2026-3308).

The commands below run from the directory containing this `SKILL.md`. From
elsewhere, use absolute paths to the skill's interpreter and script. Activation
is unnecessary; always call the environment's interpreter explicitly.

### Windows PowerShell

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
```

Run installation only on initial setup or after changing the requirements.
Installation may access the package index; document inspection itself stays local.
The parser is not a sandbox or a malware detector. Use an appropriately isolated
environment for files from untrusted sources.

## Operations

Identify the exact path before invoking the script. Do not substitute a directory,
wildcard, arbitrary latest file, or an older copy when the intended file is
unavailable. Missing input or tooling is an incomplete check, not proof that a
PDF is bad.

### Inspect metadata

```powershell
& .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py inspect 'C:\private\document.pdf'
```

Reports whether the file can be opened as a nonempty PDF with pages, its byte
count and page count, `passwordProtected`, and parser repair/warning evidence.
It does not load page content, render pages, read stdin, or require text checks.

Password protection is a fact for the caller to interpret, not an automatic
acceptance decision. `inspect` can report `passwordProtected: true` without
failing to inspect metadata; parser warnings may still make its result
`INCONCLUSIVE`. The caller must inspect the flag, not just the exit code.

### Check rendering

```powershell
& .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py render 'C:\private\document.pdf'
```

Renders every page at 72 DPI in memory without extracting text. Each bitmap is
released immediately after its dimensions are checked, before allocating the
next page. No images are encoded or saved. Blank and image-only pages can pass
this operation without proving anything about their content.

The renderer limits a page to 16 million pixels at this resolution. An invalid or
oversized page is listed in `skippedPages` and makes rendering `INCONCLUSIVE`,
not `PASS`; Python-reported rendering memory exhaustion is also incomplete rather
than proof of a bad PDF. This bounds canvas allocation, not every possible parser
resource cost; there is no guarantee of safe execution for arbitrary hostile files.

### Match text

Supply sensitive values through UTF-8 JSON on stdin with `--options-stdin`, not
command-line options. Both this flag and a nonempty `checks` array are required;
omitting either returns `CHECKS_REQUIRED` with exit code `2`, before opening the
file. This requirement applies only to `match`; `inspect` and `render` neither
accept nor need `--options-stdin`.

Each check requires a nonempty `text` and explicit one-based `pages`. The script
does a case-sensitive literal substring search after collapsing whitespace in
both strings. It never interprets the text as a regular expression or silently
converts dates. Only requested pages are loaded for text extraction, once per page,
and no page is rendered. The report identifies checks by their one-based input index.

This example contains synthetic values only:

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
@'
{
  "checks": [
    {"text": "Reference ABC-123", "pages": [1]},
    {"text": "Period 2026-08", "pages": [1]}
  ]
}
'@ | & .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py match 'C:\private\document.pdf' --options-stdin
```

Do not put real expected values or options files in a repository or report. Feed
them from a private local source without logging the request. The script accepts
a UTF-8 BOM as well.

`FOUND` means the literal appeared on at least one requested page. `NOT_FOUND`
means none of those pages contained it in the extracted text. Both are completed
search results and can return exit `0`; the caller decides whether absence fails
its validation. Missing or empty extracted text without a match makes a check
`INCONCLUSIVE`. No OCR or image-review fallback is provided.

Python-reported memory exhaustion during extraction or normalization makes that
page's text unavailable. Exhaustion during matching returns
`CONTENT_CHECK_RESOURCE_LIMIT` with inconclusive content while retaining parse
evidence. Malformed or excessively nested JSON returns `INVALID_OPTIONS_JSON`;
unreadable or exhausted stdin returns `OPTIONS_UNREADABLE` or
`OPTIONS_RESOURCE_LIMIT`. Diagnostics never contain the expected strings.

### Protected or changing files

No operation accepts passwords or attempts authentication. `render` and `match`
cannot process a PDF requiring an opening password: they return
`PASSWORD_PROTECTED`, exit `2`, and `NOT_RUN` for the requested capability, while
retaining metadata. Encryption with no opening password does not itself prevent
the operations from running.

Every completed operation checks whether the source size or modification time
changed during that invocation. `INPUT_CHANGED_DURING_CHECK` makes its evidence
incomplete. The caller is responsible for using the same unchanged file when
combining results from multiple invocations.

## Result contract

Example from `match`; it deliberately does not claim to have rendered pages:

```json
{
  "operation": "match",
  "bytes": 248182,
  "pages": 8,
  "passwordProtected": false,
  "parse": "PASS",
  "render": "NOT_RUN",
  "failedPages": [],
  "skippedPages": [],
  "warnings": [],
  "contentCheck": "FOUND",
  "checks": [
    {"index": 1, "pages": [1], "result": "FOUND", "matchedPages": [1]},
    {"index": 2, "pages": [1], "result": "FOUND", "matchedPages": [1]}
  ],
  "errors": []
}
```

- **Operation:** `inspect`, `render`, or `match`. Invalid command input can report
  `null` when no valid operation was parsed. Unexecuted capabilities remain
  `NOT_RUN`; never combine them into an implied overall pass.
- **Metadata:** `bytes`, `pages`, and `passwordProtected` are `null` when not
  established. `passwordProtected: true` is not an automatic tool-level `FAIL`.
- **Parsing:** `PASS`, `FAIL` (not a usable PDF),
  `INCONCLUSIVE` (repair or engine warnings), or `NOT_RUN` (input/tooling problem).
  A repaired document is never reported as a clean parse success.
- **Rendering:** `PASS` only after every page produces a bitmap with nonzero
  dimensions. This is technical renderability, not a judgment of layout, clipping,
  glyph appearance, or visual completeness. `FAIL` includes the one-based
  `failedPages`; `INCONCLUSIVE` includes `skippedPages`. `NOT_RUN` means rendering
  could not begin.
- **Content:** `NOT_RUN`, `FOUND`, `NOT_FOUND`, or `INCONCLUSIVE`. `NOT_RUN`
  means matching was not requested, its input was missing, or a prerequisite
  prevented execution. Each completed check's
  result includes requested pages and `matchedPages`. A check is inconclusive
  when no match is found and at least one requested page has unavailable/empty
  extracted text. The aggregate is `INCONCLUSIVE` if any check is inconclusive,
  otherwise `NOT_FOUND` if any did not match, otherwise `FOUND`.
- **Diagnostics:** `warnings` and `errors` contain fixed codes only. Examples:
  `PDF_REPAIRED`, `PDF_ENGINE_WARNINGS`, `FILE_NOT_FOUND`, `DEPENDENCY_MISSING`,
  `CHECKS_REQUIRED`, `PASSWORD_PROTECTED`, `PAGE_OUT_OF_RANGE`, and
  `INPUT_CHANGED_DURING_CHECK`. A tooling error must not become an empty,
  success-shaped result.

Exit codes:

| Code | Meaning |
| ---- | ------- |
| `0` | The requested capability completed without parser warnings/errors. For `match`, both `FOUND` and `NOT_FOUND` count as completed searches. |
| `1` | A file-open/format failure or page-rendering failure was observed. |
| `2` | Input/tooling problem, parser warning/repair, skipped work, or unconfirmed text. Inspect the JSON for the reason. |

When both a technical failure and an incomplete check exist, exit code `1`
takes precedence; the separate fields retain both outcomes. Inspect the exit
status **and** JSON. Report only sanitized evidence and any unconfirmed checks,
not the private path or content. A zero exit code never means the caller's full
workflow passed. Text matches are literal evidence, not semantic identity or
visual correctness; successful rendering does not validate layout or clipping.
The caller defines required operations, expected fields, and acceptance gates.

Keep source documents and sensitive options outside repositories and shared reports.
If you created a private temporary options file, remove only that file when finished;
leave the original PDF and reusable tool environment intact.

## Maintaining the tool

The synthetic tests generate their PDFs in temporary directories; no real
documents or credentials are needed:

```powershell
& .\.venv\Scripts\python.exe -m unittest discover -s .\tests -v
```

Keep dependency changes explicit and rerun these tests after changing the script
or pin. Preserve tests for capability isolation, match input checks, Unicode paths, blank/image-only
pages, malformed and repaired PDFs, encrypted files, scoped text, render/extraction
and matching failures, invalid input limits, and sanitized errors. Verify that
inspection writes no image or text files and releases each bitmap before allocating
the next. Never replace these fixtures with private documents.
