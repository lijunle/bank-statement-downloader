---
name: pdf-validation
description: Provide independent local PDF capabilities to inspect metadata, check in-memory rendering, or search the whole PDF for one text value. Use when processing a supplied or downloaded PDF without exposing its contents or exporting images; callers define acceptance policy.
---

# PDF Capabilities

Use [validate_pdf.py](validate_pdf.py) for three independent operations:

| Command | Capability | Not performed |
| ------- | ---------- | ------------- |
| `inspect` | PDF metadata and parser diagnostics. | Rendering or text extraction. |
| `render` | Render every page in memory. | Text extraction or image export. |
| `match` | Search the entire PDF for one literal text value. | Rendering, OCR, or visual inspection. |

No command modifies the source, writes images or document text, or makes network
requests. Normal output is a single sanitized JSON object. Help is plain text.
Private paths, search values, extracted content, and raw parser messages are not
included in reports.

## Setup and help

Use Python 3.10 or newer and a dedicated virtual environment in this skill's
`.venv`. Run these commands from the directory containing this `SKILL.md`:

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
```

Reuse this environment between documents. Install only on initial setup or when
[requirements.txt](requirements.txt) changes, not into an application's environment.
PyMuPDF 1.28.2 includes MuPDF 1.28.2; older MuPDF versions through 1.27.0 are
affected by [CVE-2026-3308](https://www.cve.org/CVERecord?id=CVE-2026-3308).
Do not keep using an older installation after the pin changes.

From another directory, use absolute paths to this interpreter and script.
Activation is unnecessary. Consult the script itself for the authoritative inputs,
output fields, diagnostic codes, exit semantics, and examples:

```powershell
& .\.venv\Scripts\python.exe .\validate_pdf.py --help
& .\.venv\Scripts\python.exe .\validate_pdf.py inspect --help
& .\.venv\Scripts\python.exe .\validate_pdf.py render --help
& .\.venv\Scripts\python.exe .\validate_pdf.py match --help
```

## Inspect metadata

```powershell
& .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py inspect --file 'C:\private\document.pdf'
```

No stdin is required. The result contains metadata, not render or search results:

```json
{"status":"COMPLETE","warnings":[],"errors":[],"bytes":12345,"pages":2,"passwordProtected":false,"repaired":false}
```

Unknown metadata is `null`. Password protection is reported as a fact; it is not
an automatic failure to inspect metadata. Repairs and engine warnings make the
operation incomplete. Callers must interpret the metadata, not just the exit code.

## Check rendering

```powershell
& .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py render --file 'C:\private\document.pdf'
```

No text or stdin is needed. Every page is rendered at 72 DPI, then its bitmap is
immediately released. No images are encoded or saved.

```json
{"status":"COMPLETE","warnings":[],"errors":[],"pages":2,"renderedPages":2,"failedPages":[],"skippedPages":[]}
```

`renderedPages` is a count; page lists are one-based. Blank or image-only pages can
render successfully without proving their content. A page over 16 million pixels,
invalid dimensions, or Python-reported allocation failure is skipped and reported,
not counted as success. Other page-rendering failures return `FAILED`.

## Match one text value

Provide `--file` and `--text VALUE`. Named arguments may appear in either order.
No stdin, JSON, page numbers, or batch protocol is needed. This example uses
synthetic text:

```powershell
& .\.venv\Scripts\python.exe -X utf8 .\validate_pdf.py match --file 'C:\private\document.pdf' --text 'Reference ABC-123'
```

Both named arguments are required. Empty or whitespace-only text is rejected.
The tool never reads stdin.
For a literal beginning with `--`, use `--text=VALUE` to avoid option parsing.
Line breaks and whitespace are collapsed in both the input and extracted page text.
Matching is case-sensitive and stays within each page: no regex, date conversion,
or matching across page boundaries. Every page is searched to report all matches.

```json
{"status":"COMPLETE","warnings":[],"errors":[],"pages":2,"searchedPages":2,"result":"FOUND","matchedPages":[1],"failedPages":[],"textlessPages":[]}
```

- `FOUND`: at least one page matched. An extraction failure on another page still
  makes `status` incomplete and exit nonzero because not all results are known.
- `NOT_FOUND`: all pages provided text but none matched. This is a completed search
  with exit `0`, not a tool failure; caller policy decides whether absence fails.
- `INCONCLUSIVE`: no match and at least one page had unavailable or empty text.
  Blank and image-only pages are listed in `textlessPages`, not declared corrupt.
- `NOT_RUN`: invalid input or a prerequisite prevented searching.

`searchedPages` counts successfully extracted/normalized pages, including empty
ones. `failedPages` records page-loading, extraction, or search failures.

For multiple expected fields, make separate calls. Each reopens the file and
extracts its text without rendering; there is no batch cache. Choose that tradeoff
consciously for large documents. Do not invent expected values from the candidate
PDF merely to obtain a match. Literal occurrences are evidence, not semantic
identity; report their page numbers and let the caller interpret the results.

The `--text` value can appear in process arguments, shell history, or tool logs
even though the script does not echo it. Treat invocations containing private
values as sensitive; do not copy or publish them in repositories or reports.

## Common operating rules

- Supply `--file` with an exact local file, never a wildcard, arbitrary latest download, or
  substitute older copy. Keep the same unchanged file when combining operations;
  per-invocation size/time checks do not establish provenance across invocations.
- Each command returns only its own fields plus `status`, `warnings`, and `errors`.
  Invalid CLI arguments return just those shared diagnostic fields. There is no
  combined report claiming unrequested capabilities were checked.
- Exit `0` means the requested capability completed; exit `1` means a technical
  file-format/render failure; exit `2` means input/tooling trouble, warnings, or
  incomplete work. Read the JSON as well. `NOT_FOUND` can exit `0`; an encrypted
  PDF's metadata can be inspected without accepting that document for a workflow.
- No passwords are collected or used. `render` and `match` return
  `PASSWORD_PROTECTED` with exit `2` if an opening password is needed; the caller
  decides whether that condition fails its workflow.
- Keep files and search values private. Rendering verifies technical renderability,
  not layout, glyph appearance, clipping, or visual completeness. Missing extracted
  text is not proof of corruption, and there is no OCR or image-review fallback.
- Installation may access a package index, but document operations remain local.
  The parser is not a sandbox, malware scanner, or universal PDF conformance checker.
  Its page allocation limit does not bound all possible parser resource use.
  Use an appropriately isolated environment for untrusted files.

## Maintaining the tool

```powershell
& .\.venv\Scripts\python.exe -m unittest discover -s .\tests -v
```

Tests generate synthetic PDFs in temporary directories and clean them up. Preserve
capability isolation, exact result shapes, full-document literal searches, no image
or text output, bitmap lifetime, Unicode paths/input, protection/repair diagnostics,
and sanitized failure handling. Update command help and tests together with any
interface change. Never use private PDFs as repository fixtures.
