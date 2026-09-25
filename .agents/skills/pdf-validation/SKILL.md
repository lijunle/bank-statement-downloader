---
name: pdf-validation
description: Validate an explicitly selected local PDF by parsing it, rendering every page in memory, and matching required expected text on specified pages. Use when checking a downloaded or supplied PDF without exposing its contents or exporting images.
---

# PDF Validation

Use [validate_pdf.py](validate_pdf.py) to inspect one exact local file. It does not
operate browsers, choose the newest download, download files, or determine whether
an application works end to end. The caller must establish the file's provenance
and decide which document and content are expected.

The script reads the source without modifying it. It makes no network requests,
saves no images or extracted text, and emits one JSON object containing counts,
statuses, page numbers, and diagnostic codes, not filenames, expected strings,
extracted text, or raw parser messages. `--help` prints usage instead of JSON.

## 1. Prepare the local tool once

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

## 2. Select the exact file and expected content

Identify the exact path before invoking the script. Do not substitute a directory,
wildcard, arbitrary latest file, or an older copy when the intended file is
unavailable. Missing input or tooling is an incomplete check, not proof that a
PDF is bad.

Every invocation must include at least one page-scoped expected-text check. Derive
meaningful expected content from the caller's request or an independent reference,
not from whatever text happens to be in the candidate PDF. Include all content
needed for the requested validation; do not reduce it to a generic word just to
obtain a match. If expected content is unavailable, obtain it before running the
check rather than silently performing a structure-only validation.

## 3. Run parsing, rendering, and content checks

Every validation has three required stages:

1. **Parse:** open the file and confirm it is a nonempty PDF with pages. Reject
   opening-password protection and report parser repairs or engine warnings.
2. **Render in memory:** render **every page**, one at a time, at 72 DPI. Blank
   pages and image-only pages can render successfully; extractable text is not
   a rendering requirement. Release each bitmap before text extraction or the
   next page's allocation. No images are exported or visually inspected.
3. **Match expected text:** extract text locally from the specified pages and
   search for every supplied expected literal. Return matching page numbers and
   statuses, never document text.

The script also checks whether the source size or modification time changed
during inspection.

The renderer limits a page to 16 million pixels at this resolution. An invalid or
oversized page is listed in `skippedPages` and makes rendering `INCONCLUSIVE`,
not `PASS`; Python-reported rendering memory exhaustion is also incomplete rather
than proof of a bad PDF. This bounds canvas allocation, not every possible parser
resource cost; there is no guarantee of safe execution for arbitrary hostile files.
Normalize each selected page's extracted whitespace once, within the text-extraction
error boundary. Python-reported memory exhaustion during extraction/normalization
makes that page's text unavailable. Memory exhaustion during subsequent matching
returns `CONTENT_CHECK_RESOURCE_LIMIT` with inconclusive content while retaining
the completed parsing/rendering results.

Supply sensitive values through UTF-8 JSON on stdin with `--options-stdin`, not
command-line options. Both this flag and a nonempty `checks` array are required;
omitting either returns `CHECKS_REQUIRED` with exit code `2`, before opening the
file. There are no built-in account, date, financial-institution, or
document-layout rules. Invalid JSON, including integer-conversion or nesting-limit
failures, returns `INVALID_OPTIONS_JSON`. Unreadable stdin and Python-reported
input memory exhaustion return `OPTIONS_UNREADABLE` and `OPTIONS_RESOURCE_LIMIT`.
These are input/tooling errors (exit `2`), not evidence of an invalid PDF.

Each check requires a nonempty `text` and explicit one-based `pages`. The script
does a case-sensitive literal substring search after collapsing whitespace in
both strings. It never interprets the text as a regular expression or silently
converts dates. The report identifies checks by their one-based input index.

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
'@ | & .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py 'C:\private\document.pdf' --options-stdin
```

Do not put real expected values or options files in a repository or report. Feed
them from a private local source without logging the request. The script accepts
a UTF-8 BOM as well.

`FOUND` means only that the literal appeared on a requested page. It is **not**
semantic proof of document identity: an identifier can appear in unrelated body
text. Choose pages deliberately and combine identifying fields with the expected
document period or other distinguishing content. Avoid a single generic name or
short identifier as the only evidence when more context is required.

If a required check is `NOT_FOUND` or `INCONCLUSIVE`, content has not been
confirmed and the exit code is `2`, even when parsing and rendering pass. Missing
text does not prove PDF corruption: image-only pages, formatting, fonts, or
extraction failures can prevent a match. No OCR, image review, or external
analysis service is used as a fallback. Report the unconfirmed check; do not
remove or weaken expectations just to get a successful exit code.

### Password-protected documents fail validation

A PDF that requires an opening password is a **FAIL**, with `PASSWORD_PROTECTED`
and exit code `1`. Rendering and text checks are not run. Do not ask for
a password or attempt to unlock it: the tool has no password input or authentication
path, and a `password` key in stdin JSON is rejected as `INVALID_OPTIONS`.

This is a validation-policy failure, not a claim that the PDF is corrupt. An
encrypted PDF that opens without a password, such as one with only owner permission
restrictions, still undergoes the normal rendering and required content checks.

## 4. Interpret the result

Example of successful parsing, rendering, and the two required checks above:

```json
{
  "bytes": 248182,
  "pages": 8,
  "parse": "PASS",
  "render": "PASS",
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

- **Parsing:** `PASS`, `FAIL` (including opening-password protection),
  `INCONCLUSIVE` (repair or engine warnings), or `NOT_RUN` (input/tooling problem).
  A repaired document is never reported as a clean parse success.
- **Rendering:** `PASS` only after every page produces a bitmap with nonzero
  dimensions. This is technical renderability, not a judgment of layout, clipping,
  glyph appearance, or visual completeness. `FAIL` includes the one-based
  `failedPages`; `INCONCLUSIVE` includes `skippedPages`. `NOT_RUN` means rendering
  could not begin.
- **Content:** `NOT_RUN`, `FOUND`, `NOT_FOUND`, or `INCONCLUSIVE`. `NOT_RUN`
  means required input is missing or another prerequisite prevented the checks;
  it never permits a successful exit. Each completed check's
  result includes requested pages and `matchedPages`. A check is inconclusive
  when no match is found and at least one requested page has unavailable/empty
  extracted text. Rendering can still pass, but exit code `0` requires **all**
  content checks to be `FOUND`.
- **Diagnostics:** `warnings` and `errors` contain fixed codes only. Examples:
  `PDF_REPAIRED`, `PDF_ENGINE_WARNINGS`, `FILE_NOT_FOUND`, `DEPENDENCY_MISSING`,
  `CHECKS_REQUIRED`, `PASSWORD_PROTECTED`, `PAGE_OUT_OF_RANGE`, and
  `INPUT_CHANGED_DURING_CHECK`. A tooling error must not become an empty,
  success-shaped result.

Exit codes:

| Code | Meaning |
| ---- | ------- |
| `0` | Parsing and in-memory rendering passed and every required expected-text check was found; still not visual, semantic, or end-to-end acceptance. |
| `1` | Opening-password protection, a file-open/format failure, or a page-rendering failure was observed. |
| `2` | Input/tooling problem, parser warning/repair, skipped work, or unconfirmed text. Inspect the JSON for the reason. |

When both a file validation failure and an incomplete check exist, exit code `1`
takes precedence; the separate fields retain both outcomes. Inspect the exit
status **and** JSON. Report only sanitized evidence and any unconfirmed checks,
not the private path or content. Do not infer download provenance, freshness,
business correctness, visual correctness, or application E2E success from this result.

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
or pin. Preserve tests for required content checks, Unicode paths, blank/image-only
pages, malformed and repaired PDFs, encrypted files, scoped text, render/extraction
and matching failures, invalid input limits, and sanitized errors. Verify that
inspection writes no image or text files and releases each bitmap before allocating
the next. Never replace these fixtures with private documents.
