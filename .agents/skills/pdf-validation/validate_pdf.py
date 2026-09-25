"""Read-only PDF inspection with sanitized, machine-readable evidence."""

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
class TextCheck:
    text: str
    pages: list[int]


@dataclass
class CheckResult:
    index: int
    pages: list[int]
    result: str
    matchedPages: list[int] = field(default_factory=list)


@dataclass
class Report:
    bytes: int | None = None
    pages: int | None = None
    parse: str = "NOT_RUN"
    render: str = "NOT_RUN"
    failedPages: list[int] = field(default_factory=list)
    skippedPages: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    contentCheck: str = "NOT_RUN"
    checks: list[CheckResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def exit_code(self) -> int:
        if self.parse == "FAIL" or self.render == "FAIL":
            return 1
        if (
            self.errors
            or self.parse != "PASS"
            or self.render != "PASS"
            or self.contentCheck != "FOUND"
        ):
            return 2
        return 0


def page_numbers(value: object) -> list[int]:
    if (
        not isinstance(value, list)
        or not value
        or any(type(number) is not int or number < 1 for number in value)
        or len(value) != len(set(value))
    ):
        raise InputError("INVALID_PAGE_SELECTION")
    return sorted(value)


def read_options() -> list[TextCheck]:
    try:
        options = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise InputError("INVALID_OPTIONS_JSON") from None
    if not isinstance(options, dict) or options.keys() - {"checks"}:
        raise InputError("INVALID_OPTIONS")
    if "checks" not in options:
        raise InputError("CHECKS_REQUIRED")
    checks = options["checks"]
    if not isinstance(checks, list):
        raise InputError("INVALID_TEXT_CHECKS")
    if not checks:
        raise InputError("CHECKS_REQUIRED")
    parsed = []
    for check in checks:
        if not isinstance(check, dict) or set(check) != {"text", "pages"}:
            raise InputError("INVALID_TEXT_CHECK")
        text = check["text"]
        if not isinstance(text, str) or not text.strip():
            raise InputError("INVALID_EXPECTED_TEXT")
        parsed.append(TextCheck(text, page_numbers(check["pages"])))
    return parsed


def check_text(
    checks: list[TextCheck], texts: dict[int, str | None]
) -> tuple[str, list[CheckResult]]:
    results = []
    for index, check in enumerate(checks, 1):
        expected = " ".join(check.text.split())
        matched = [
            number for number in check.pages
            if texts.get(number) is not None
            and expected in " ".join(texts[number].split())
        ]
        if matched:
            status = "FOUND"
        elif any(
            texts.get(number) is None or not texts[number].strip()
            for number in check.pages
        ):
            status = "INCONCLUSIVE"
        else:
            status = "NOT_FOUND"
        results.append(CheckResult(index, check.pages, status, matched))
    if not results:
        return "NOT_RUN", results
    if any(result.result == "INCONCLUSIVE" for result in results):
        return "INCONCLUSIVE", results
    return (
        "FOUND" if all(result.result == "FOUND" for result in results) else "NOT_FOUND",
        results,
    )


def inspect_pdf(
    path: Path,
    checks: list[TextCheck],
) -> Report:
    report = Report()
    if not checks:
        report.errors.append("CHECKS_REQUIRED")
        return report
    try:
        import pymupdf
    except ModuleNotFoundError:
        report.errors.append("DEPENDENCY_MISSING")
        return report
    except (ImportError, OSError):
        report.errors.append("DEPENDENCY_UNAVAILABLE")
        return report

    pdf_errors = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)
    # MuPDF diagnostics can contain document text or paths; expose codes instead.
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    pymupdf.TOOLS.mupdf_warnings(reset=True)
    try:
        before = path.stat()
        if not path.is_file():
            report.errors.append("INPUT_NOT_FILE")
            return report
        report.bytes = before.st_size
    except FileNotFoundError:
        report.errors.append("FILE_NOT_FOUND")
        return report
    except OSError:
        report.errors.append("FILE_UNREADABLE")
        return report
    if report.bytes == 0:
        report.parse = "FAIL"
        report.errors.append("EMPTY_FILE")
        return report

    try:
        document = pymupdf.open(path)
    except pdf_errors:
        report.parse = "FAIL"
        report.errors.append("PDF_OPEN_FAILED")
        return report
    except OSError:
        report.errors.append("FILE_UNREADABLE")
        return report
    except MemoryError:
        report.errors.append("RESOURCE_LIMIT")
        return report

    with document:
        if not document.is_pdf:
            report.parse = "FAIL"
            report.errors.append("NOT_PDF")
            return report
        try:
            report.pages = document.page_count
            needs_password = document.needs_pass
        except pdf_errors:
            report.parse = "FAIL"
            report.errors.append("PDF_METADATA_FAILED")
            return report
        if needs_password:
            report.parse = "FAIL"
            report.errors.append("PASSWORD_PROTECTED")
            return report
        if report.pages == 0:
            report.parse = "FAIL"
            report.errors.append("NO_PAGES")
            return report
        report.parse = "INCONCLUSIVE" if document.is_repaired else "PASS"
        if document.is_repaired:
            report.warnings.append("PDF_REPAIRED")

        selected_pages = [number for check in checks for number in check.pages]
        if any(number > report.pages for number in selected_pages):
            report.errors.append("PAGE_OUT_OF_RANGE")
            return report

        report.render = "PASS"
        texts: dict[int, str | None] = {}
        text_pages = {number for check in checks for number in check.pages}
        for number in range(1, report.pages + 1):
            try:
                page = document.load_page(number - 1)
                width, height = page.rect.width, page.rect.height
                if (
                    not math.isfinite(width) or not math.isfinite(height)
                    or width <= 0 or height <= 0
                    or math.ceil(width) * math.ceil(height) > MAX_PAGE_PIXELS
                ):
                    report.skippedPages.append(number)
                    report.warnings.append("PAGE_RENDER_LIMIT")
                    continue
                pixmap = page.get_pixmap(dpi=72, alpha=False)
                if pixmap.width == 0 or pixmap.height == 0:
                    raise ValueError("Empty rendering")
            except MemoryError:
                report.skippedPages.append(number)
                report.warnings.append("PAGE_RENDER_RESOURCE_LIMIT")
                continue
            except pdf_errors:
                report.failedPages.append(number)
                continue

            if number in text_pages:
                try:
                    texts[number] = page.get_text()
                except (MemoryError, *pdf_errors):
                    texts[number] = None
                    report.warnings.append("TEXT_EXTRACTION_FAILED")

        if report.failedPages:
            report.render = "FAIL"
            report.errors.append("PAGE_RENDER_FAILED")
        elif report.skippedPages:
            report.render = "INCONCLUSIVE"
        report.contentCheck, report.checks = check_text(checks, texts)
        if pymupdf.TOOLS.mupdf_warnings(reset=True):
            report.warnings.append("PDF_ENGINE_WARNINGS")
            if report.parse == "PASS":
                report.parse = "INCONCLUSIVE"
    try:
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            report.errors.append("INPUT_CHANGED_DURING_CHECK")
    except OSError:
        report.errors.append("INPUT_UNAVAILABLE_AFTER_CHECK")
    report.warnings = list(dict.fromkeys(report.warnings))
    return report


def main(argv: list[str] | None = None) -> int:
    parser = Parser(description=__doc__)
    parser.add_argument("path", type=Path, help="Exact local PDF path; never auto-selected")
    parser.add_argument(
        "--options-stdin", action="store_true",
        help="Required: read UTF-8 JSON with nonempty page-scoped expected-text checks",
    )
    try:
        args = parser.parse_args(argv)
        if not args.options_stdin:
            raise InputError("CHECKS_REQUIRED")
        checks = read_options()
        report = inspect_pdf(args.path, checks)
    except InputError as error:
        report = Report(errors=[str(error)])
    print(json.dumps(asdict(report), ensure_ascii=True))
    return report.exit_code()


if __name__ == "__main__":
    raise SystemExit(main())
