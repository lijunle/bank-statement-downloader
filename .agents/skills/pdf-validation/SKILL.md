---
name: pdf-validation
description: Inspect an explicitly selected local PDF for parsing and page-rendering problems, optionally locate expected text on specified pages, and export selected page images for private visual inspection. Use when checking a downloaded or supplied PDF without exposing its contents.
---

# PDF Validation

Use [validate_pdf.py](validate_pdf.py) to inspect one exact local file. It does not
operate browsers, choose the newest download, download files, or determine whether
an application works end to end. The caller must establish the file's provenance
and decide which document and content are expected.

The script reads the source without modifying it. It makes no network requests
and emits one JSON object containing counts, statuses, page numbers, and diagnostic
codes, not filenames, passwords, expected strings, extracted text, or raw parser
messages. `--help` prints usage instead of JSON.

## 1. Prepare the local tool once

Use Python 3.10 or newer with the exact dependency in
[requirements.txt](requirements.txt). Keep a dedicated virtual environment in
this skill's `.venv` directory and reuse it between documents. Do not install
into an application's dependency environment, automatically upgrade the pin, or
delete the environment after each check.

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

## 2. Inspect the exact file

```powershell
& .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py 'C:\private\document.pdf'
```

Do not substitute a directory, wildcard, arbitrary latest file, or an older copy
when the intended file is unavailable. Missing input or tooling is an incomplete
check, not proof that a PDF is bad.

The script:

1. Opens the file and confirms that it is a nonempty PDF with pages.
2. Detects password requirements, parser repairs, and engine warnings.
3. Renders **every page**, one at a time, at 72 DPI in memory. It does not require
   extractable text, so blank pages and image-only pages can render successfully.
4. Optionally searches for literal text on explicitly selected pages.
5. Checks whether the source size or modification time changed during inspection.

The renderer limits a page to 16 million pixels at this resolution. An invalid or
oversized page is listed in `skippedPages` and makes rendering `INCONCLUSIVE`,
not `PASS`; Python-reported rendering memory exhaustion is also incomplete rather
than proof of a bad PDF. This bounds canvas allocation, not every possible parser resource
cost; there is no guarantee of safe execution for arbitrary hostile files.

## 3. Optional text checks and passwords

Supply sensitive values through UTF-8 JSON on stdin with `--options-stdin`, not
command-line options. There are no built-in account, date, financial-institution,
or document-layout rules.

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

The JSON may also contain a string `password` when the user has authorized access.
Do not ask users to paste passwords into chat or put real passwords, expected
values, or options files in a repository or report. Feed them from a private local
source without logging the request. The script accepts a UTF-8 BOM as well.

`FOUND` means only that the literal appeared on a requested page. It is **not**
semantic proof of document identity: an identifier can appear in unrelated body
text. Choose pages deliberately, then inspect the relevant heading or field
visually when its meaning matters. `NOT_FOUND` does not prove corruption or a
wrong document; formatting, fonts, or extraction may require manual inspection.
No OCR or external analysis service is used.

## 4. Export selected pages only when needed

To inspect layout, suspicious rendering, or image-only content, provide an
existing private output directory and a nonempty list of page numbers:

```powershell
& .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py 'C:\private\document.pdf' --render-dir 'C:\private\inspection' --render-pages 1 3
```

All pages are still rendered in memory; only the selected pages are saved as
`page-0001.png`, `page-0003.png`, and so on. Existing output files are never
overwritten. Use a fresh directory or explicitly remove only your previous
temporary outputs before retrying. On export failure, inspect the output
directory for incomplete newly created images; do not treat them as successful
exports.

Open those exact images with a local image viewer. Look for missing content,
garbled glyphs, clipped text, and the expected document fields. A successful
render is not proof that a page looks correct. Inspect a blank or image-only page
in context instead of declaring it invalid merely because text extraction is empty.

Keep all source documents, page images, and sensitive options outside repositories
and shared reports. After inspection, remove only the temporary images/options
you created; leave the original PDF and reusable tool environment intact.

## 5. Interpret the result

Example of successful parsing/rendering without content checks:

```json
{
  "bytes": 248182,
  "pages": 8,
  "parse": "PASS",
  "render": "PASS",
  "failedPages": [],
  "skippedPages": [],
  "warnings": [],
  "contentCheck": "NOT_REQUESTED",
  "checks": [],
  "exportedPages": [],
  "errors": []
}
```

- **Parsing:** `PASS`, `FAIL`, `BLOCKED` (password required/rejected),
  `INCONCLUSIVE` (repair or engine warnings), or `NOT_RUN` (input/tooling problem).
  A repaired document is never reported as a clean parse success.
- **Rendering:** `PASS` only after every page renders; `FAIL` includes the
  one-based `failedPages`; `INCONCLUSIVE` includes `skippedPages`. `BLOCKED` or
  `NOT_RUN` means rendering could not begin.
- **Content:** `NOT_REQUESTED`, `FOUND`, `NOT_FOUND`, or `INCONCLUSIVE`. Each
  result includes requested pages and `matchedPages`. A check is inconclusive
  when no match is found and at least one requested page has unavailable/empty
  extracted text. Rendering can still pass.
- **Diagnostics:** `warnings` and `errors` contain fixed codes only. Examples:
  `PDF_REPAIRED`, `PDF_ENGINE_WARNINGS`, `FILE_NOT_FOUND`, `DEPENDENCY_MISSING`,
  `PASSWORD_REQUIRED`, `PAGE_OUT_OF_RANGE`, `PAGE_EXPORT_FAILED`, and
  `INPUT_CHANGED_DURING_CHECK`. A tooling error must not become an empty,
  success-shaped result.

Exit codes:

| Code | Meaning |
| ---- | ------- |
| `0` | Parsing and rendering passed, requested text was found, and requested exports completed; still not semantic or end-to-end acceptance. |
| `1` | A definite file-open/format or page-rendering failure was observed. |
| `2` | Input/tooling/export problem, password block, parser warning/repair, skipped work, or unconfirmed text. Inspect the JSON for the reason. |

When both a definite file failure and an incomplete check exist, exit code `1`
takes precedence; the separate fields retain both outcomes. Inspect the exit
status **and** JSON. Report only sanitized evidence and outstanding manual checks,
not the private path or content. Do not infer download provenance, freshness,
business correctness, or application E2E success from this result.

## Maintaining the tool

The synthetic tests generate their PDFs in temporary directories; no real
documents or credentials are needed:

```powershell
& .\.venv\Scripts\python.exe -m unittest discover -s .\tests -v
```

Keep dependency changes explicit and rerun these tests after changing the script
or pin. Preserve tests for Unicode paths, blank/image-only pages, malformed and
repaired PDFs, encrypted files, scoped text, page/export failures, and sanitized
errors. Never replace these fixtures with private documents.
