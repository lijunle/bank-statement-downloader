"""Independent, read-only PDF capabilities with sanitized JSON results."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
import json
import math
from pathlib import Path
import sys


MAX_PAGE_PIXELS = 16_000_000


class InputError(ValueError):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise InputError("INVALID_ARGUMENTS")


@dataclass
class Result:
    status: str = "INCOMPLETE"
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def exit_code(self) -> int:
        if self.status == "FAILED":
            return 1
        if self.status != "COMPLETE" or self.errors or self.warnings:
            return 2
        return 0


@dataclass
class InspectResult(Result):
    bytes: int | None = None
    pages: int | None = None
    passwordProtected: bool | None = None
    repaired: bool | None = None


@dataclass
class RenderResult(Result):
    pages: int | None = None
    renderedPages: int = 0
    failedPages: list[int] = field(default_factory=list)
    skippedPages: list[int] = field(default_factory=list)


@dataclass
class MatchResult(Result):
    pages: int | None = None
    searchedPages: int = 0
    result: str = "NOT_RUN"
    matchedPages: list[int] = field(default_factory=list)
    failedPages: list[int] = field(default_factory=list)
    textlessPages: list[int] = field(default_factory=list)


RESULT_TYPES = {"inspect": InspectResult, "render": RenderResult, "match": MatchResult}


def normalize_expected_text(text: str) -> str:
    try:
        normalized = " ".join(text.split())
    except MemoryError:
        raise InputError("TEXT_RESOURCE_LIMIT") from None
    if not normalized:
        raise InputError("TEXT_REQUIRED")
    return normalized


def run_operation(path: Path, operation: str, text: str | None = None) -> Result:
    if operation not in RESULT_TYPES:
        return Result(errors=["INVALID_OPERATION"])
    result = RESULT_TYPES[operation]()
    if operation != "match" and text is not None:
        result.errors.append("TEXT_NOT_APPLICABLE")
        return result
    if operation == "match":
        if not isinstance(text, str):
            result.errors.append("TEXT_REQUIRED")
            return result
        try:
            expected = normalize_expected_text(text)
        except InputError as error:
            result.errors.append(str(error))
            return result

    try:
        import pymupdf
    except ModuleNotFoundError:
        result.errors.append("DEPENDENCY_MISSING")
        return result
    except (ImportError, OSError):
        result.errors.append("DEPENDENCY_UNAVAILABLE")
        return result

    pdf_errors = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)
    # Raw MuPDF diagnostics can contain document text or private paths.
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    pymupdf.TOOLS.mupdf_warnings(reset=True)
    try:
        before = path.stat()
        if not path.is_file():
            result.errors.append("INPUT_NOT_FILE")
            return result
    except FileNotFoundError:
        result.errors.append("FILE_NOT_FOUND")
        return result
    except OSError:
        result.errors.append("FILE_UNREADABLE")
        return result
    except ValueError:
        result.errors.append("INVALID_PATH")
        return result
    if isinstance(result, InspectResult):
        result.bytes = before.st_size
    if before.st_size == 0:
        result.status = "FAILED"
        result.errors.append("EMPTY_FILE")
        return result

    try:
        document = pymupdf.open(path)
    except pdf_errors:
        result.status = "FAILED"
        result.errors.append("PDF_OPEN_FAILED")
        return result
    except OSError:
        result.errors.append("FILE_UNREADABLE")
        return result
    except MemoryError:
        result.errors.append("RESOURCE_LIMIT")
        return result

    with document:
        if not document.is_pdf:
            result.status = "FAILED"
            result.errors.append("NOT_PDF")
            return result
        try:
            result.pages = document.page_count
            password_protected = bool(document.needs_pass)
            repaired = bool(document.is_repaired)
        except pdf_errors:
            result.status = "FAILED"
            result.errors.append("PDF_METADATA_FAILED")
            return result
        except MemoryError:
            result.errors.append("RESOURCE_LIMIT")
            return result
        if isinstance(result, InspectResult):
            result.passwordProtected = password_protected
            result.repaired = repaired
        if result.pages == 0:
            result.status = "FAILED"
            result.errors.append("NO_PAGES")
            return result
        if repaired:
            result.warnings.append("PDF_REPAIRED")

        if isinstance(result, InspectResult):
            result.status = "COMPLETE"
        elif password_protected:
            result.errors.append("PASSWORD_PROTECTED")
        elif isinstance(result, RenderResult):
            for number in range(1, result.pages + 1):
                try:
                    page = document.load_page(number - 1)
                    width, height = page.rect.width, page.rect.height
                    if (
                        not math.isfinite(width) or not math.isfinite(height)
                        or width <= 0 or height <= 0
                        or math.ceil(width) * math.ceil(height) > MAX_PAGE_PIXELS
                    ):
                        result.skippedPages.append(number)
                        result.warnings.append("PAGE_RENDER_LIMIT")
                        continue
                    pixmap = page.get_pixmap(dpi=72, alpha=False)
                    try:
                        if pixmap.width == 0 or pixmap.height == 0:
                            raise ValueError("Empty rendering")
                    finally:
                        del pixmap
                    result.renderedPages += 1
                except MemoryError:
                    result.skippedPages.append(number)
                    result.warnings.append("PAGE_RENDER_RESOURCE_LIMIT")
                except pdf_errors:
                    result.failedPages.append(number)
            if result.failedPages:
                result.status = "FAILED"
                result.errors.append("PAGE_RENDER_FAILED")
            elif not result.skippedPages:
                result.status = "COMPLETE"
        elif isinstance(result, MatchResult):
            for number in range(1, result.pages + 1):
                try:
                    page = document.load_page(number - 1)
                    page_text = " ".join(page.get_text().split())
                    try:
                        if expected in page_text:
                            result.matchedPages.append(number)
                        if not page_text:
                            result.textlessPages.append(number)
                    finally:
                        del page_text
                    result.searchedPages += 1
                except (MemoryError, *pdf_errors):
                    result.failedPages.append(number)
                    result.errors.append("TEXT_SEARCH_FAILED")
            if result.matchedPages:
                result.result = "FOUND"
            elif result.failedPages or result.textlessPages:
                result.result = "INCONCLUSIVE"
            else:
                result.result = "NOT_FOUND"
            if not result.failedPages and result.result != "INCONCLUSIVE":
                result.status = "COMPLETE"

        if pymupdf.TOOLS.mupdf_warnings(reset=True):
            result.warnings.append("PDF_ENGINE_WARNINGS")
    try:
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            result.errors.append("INPUT_CHANGED_DURING_CHECK")
    except OSError:
        result.errors.append("INPUT_UNAVAILABLE_AFTER_CHECK")
    result.errors = list(dict.fromkeys(result.errors))
    result.warnings = list(dict.fromkeys(result.warnings))
    if result.status == "COMPLETE" and (result.errors or result.warnings):
        result.status = "INCOMPLETE"
    return result


COMMON_HELP = """\
Shared fields: status (COMPLETE / FAILED / INCOMPLETE), warnings, errors.
Diagnostics are fixed codes; paths, expected text, and PDF contents are not echoed.
Exit codes:
  0  Requested operation completed without warnings or errors, not workflow acceptance.
  1  Observed invalid PDF or page-rendering failure (status FAILED).
  2  Invalid input, missing dependency/file, inaccessible content, warning, or incomplete work.
Common diagnostics:
  INVALID_ARGUMENTS, INVALID_PATH, FILE_NOT_FOUND, INPUT_NOT_FILE, FILE_UNREADABLE,
  DEPENDENCY_MISSING, DEPENDENCY_UNAVAILABLE, EMPTY_FILE, NOT_PDF, PDF_OPEN_FAILED,
  PDF_METADATA_FAILED, NO_PAGES, RESOURCE_LIMIT, PDF_REPAIRED, PDF_ENGINE_WARNINGS,
  INPUT_CHANGED_DURING_CHECK, INPUT_UNAVAILABLE_AFTER_CHECK.
Inspect both the JSON and exit code. No password input, OCR, image export, or networking.
"""

COMMAND_HELP = {
    "inspect": """\
Input: --file with the exact local file path. No stdin or content expectations required.
Output JSON: status, warnings, errors, bytes, pages, passwordProtected, repaired.
Unknown metadata is null. No pages are rendered and no text is extracted.
Password protection is metadata, not an automatic failure for this operation.
Exit 0 can include passwordProtected=true; caller policy decides acceptance.
Example (PowerShell, using this skill's Python interpreter):
  python validate_pdf.py inspect --file 'C:\\private\\document.pdf'
""",
    "render": """\
Input: --file with the exact local file path. No stdin required.
Output JSON: status, warnings, errors, pages, renderedPages, failedPages, skippedPages.
Counts start at zero; pages is null until known; page lists are one-based.
All pages render in memory at 72 DPI, without extracting text or writing images.
Each bitmap is released immediately. A page over 16 million pixels is skipped.
Specific diagnostics: PASSWORD_PROTECTED, PAGE_RENDER_FAILED,
  PAGE_RENDER_LIMIT, PAGE_RENDER_RESOURCE_LIMIT.
Exit 1 for a page rendering error; exit 2 for password protection or skipped pages.
Example (PowerShell, using this skill's Python interpreter):
  python validate_pdf.py render --file 'C:\\private\\document.pdf'
""",
    "match": """\
Input: required --file with the exact path and --text with one nonempty literal.
Named arguments may appear in either order. No stdin, JSON, page selector, or batch protocol.
All supplied text is one literal; line breaks/whitespace are collapsed, not separate checks.
Matching is case-sensitive, within each page, across the whole PDF. No regex or date conversion.
Output JSON: status, warnings, errors, pages, searchedPages, result,
  matchedPages, failedPages, textlessPages. Page lists are one-based.
result: FOUND / NOT_FOUND / INCONCLUSIVE / NOT_RUN.
FOUND and NOT_FOUND can both exit 0: absence is a completed search, not a tool failure.
All pages are searched to report every match. Extraction errors keep status INCOMPLETE
even if another page matched. Without a match, textless pages make absence INCONCLUSIVE.
Specific diagnostics: TEXT_REQUIRED, TEXT_RESOURCE_LIMIT, TEXT_SEARCH_FAILED, PASSWORD_PROTECTED.
No PDF is rendered. Run once per expected value; each call reopens and extracts the file.
Example (PowerShell, synthetic text only, using this skill's Python interpreter):
  python validate_pdf.py match --file 'C:\\private\\document.pdf' --text 'Reference ABC-123'
--text values may be visible in process arguments, shell history, or tool logs.
Treat invocations containing private values as sensitive; do not publish or commit them.
For a literal starting with '--', use --text=VALUE to avoid option parsing.
""",
}


def main(argv: list[str] | None = None) -> int:
    parser = Parser(
        description=__doc__,
        epilog="Use <command> --help for inputs, JSON fields, exit codes, and examples.\n"
        "Commands expose evidence independently; callers define acceptance policy.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(dest="operation", required=True)
    for name, description in (
        ("inspect", "Inspect PDF metadata without rendering or text extraction"),
        ("render", "Render every PDF page in memory without text extraction"),
        ("match", "Search the whole PDF for one explicitly supplied literal text value"),
    ):
        command = commands.add_parser(
            name, help=description, description=description,
            epilog=COMMAND_HELP[name] + "\n" + COMMON_HELP,
            formatter_class=argparse.RawDescriptionHelpFormatter,
        )
        command.add_argument(
            "--file", type=Path, required=True,
            help="Exact local PDF path; never auto-selected",
        )
        if name == "match":
            command.add_argument(
                "--text", required=True,
                help="One nonempty literal to find; note that process arguments may be logged",
            )
    operation = None
    try:
        args = parser.parse_args(argv)
        operation = args.operation
        text = args.text if operation == "match" else None
        result = run_operation(args.file, operation, text)
    except InputError as error:
        result = RESULT_TYPES.get(operation, Result)(errors=[str(error)])
    print(json.dumps(asdict(result), ensure_ascii=True))
    return result.exit_code()


if __name__ == "__main__":
    raise SystemExit(main())
