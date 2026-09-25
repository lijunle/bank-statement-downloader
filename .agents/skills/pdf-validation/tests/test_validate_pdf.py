from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import weakref

import pymupdf


SCRIPT = Path(__file__).resolve().parents[1] / "validate_pdf.py"
SPEC = importlib.util.spec_from_file_location("validate_pdf", SCRIPT)
validator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = validator
SPEC.loader.exec_module(validator)
COMMON_FIELDS = {"status", "warnings", "errors"}
COMMAND_FIELDS = {
    "inspect": {"bytes", "pages", "passwordProtected", "repaired"},
    "render": {"pages", "renderedPages", "failedPages", "skippedPages"},
    "match": {"pages", "searchedPages", "result", "matchedPages", "failedPages", "textlessPages"},
}


class PdfCapabilityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="pdf-capability-")
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        self.pdf = self.make_pdf("synthetic.pdf", ["Reference ABC-123\nPeriod 2026-08"])

    def make_pdf(self, name, pages, **save_options):
        path = self.folder / name
        with pymupdf.open() as document:
            for text in pages:
                page = document.new_page()
                if text:
                    page.insert_text((72, 72), text)
            document.save(path, **save_options)
        return path

    def run_cli(self, operation="match", path=None, text="Reference ABC-123", extra=(), no_site=False):
        command = [sys.executable, "-X", "utf8"]
        if no_site:
            command.append("-S")
        command.extend([str(SCRIPT), operation, "--file", str(path or self.pdf)])
        if operation == "match":
            command.extend(["--text", text])
        command.extend(extra)
        process = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=30)
        self.assertEqual(process.stderr, b"", "Do not leak raw diagnostics")
        self.assertEqual(len(process.stdout.splitlines()), 1)
        result = json.loads(process.stdout)
        self.assertNotIn(str(self.folder), process.stdout.decode("utf-8"))
        return process.returncode, result

    def call_main(self, operation="match", text="Reference ABC-123"):
        output, errors = io.StringIO(), io.StringIO()
        with (
            redirect_stdout(output), redirect_stderr(errors),
        ):
            args = [operation, "--file", str(self.pdf)]
            if operation == "match":
                args.extend(["--text", text])
            code = validator.main(args)
        self.assertEqual(errors.getvalue(), "")
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertNotIn("PRIVATE_", output.getvalue())
        self.assertNotIn(str(self.folder), output.getvalue())
        return code, json.loads(output.getvalue())

    def test_each_command_returns_only_its_own_fields(self):
        for operation in COMMAND_FIELDS:
            with self.subTest(operation=operation):
                code, result = self.run_cli(operation)
                self.assertEqual(code, 0)
                self.assertEqual(result["status"], "COMPLETE")
                self.assertEqual(set(result), COMMON_FIELDS | COMMAND_FIELDS[operation])
                self.assertEqual(result["warnings"], [])
                self.assertEqual(result["errors"], [])
                self.assertEqual(result["pages"], 1)

    def test_all_operations_are_read_only_and_do_not_dump_content(self):
        before = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        for operation in COMMAND_FIELDS:
            code, result = self.run_cli(operation)
            self.assertEqual(code, 0)
            self.assertNotIn("Reference ABC-123", json.dumps(result))
            self.assertNotIn("Period 2026-08", json.dumps(result))
        self.assertEqual(list(self.folder.iterdir()), [self.pdf])
        self.assertEqual(hashlib.sha256(self.pdf.read_bytes()).hexdigest(), before)

    def test_inspect_loads_no_pages_and_reads_no_stdin(self):
        with (
            patch.object(pymupdf.Document, "load_page", side_effect=AssertionError("No pages")),
            patch.object(sys, "stdin") as stdin,
            redirect_stdout(io.StringIO()) as output,
        ):
            code = validator.main(["inspect", "--file", str(self.pdf)])
            stdin.read.assert_not_called()
            stdin.buffer.read.assert_not_called()
        result = json.loads(output.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual(result["bytes"], self.pdf.stat().st_size)
        self.assertFalse(result["passwordProtected"])
        self.assertFalse(result["repaired"])

    def test_render_loads_all_pages_without_text_or_image_encoding(self):
        path = self.make_pdf("three.pdf", ["First", "", "Third"])
        seen = []
        original = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            seen.append(page.number + 1)
            return original(page, **kwargs)

        with (
            patch.object(pymupdf.Page, "get_pixmap", render),
            patch.object(pymupdf.Page, "get_text", side_effect=AssertionError("No extraction")),
            patch.object(pymupdf.Pixmap, "tobytes", side_effect=AssertionError("No encoding")),
        ):
            report = validator.run_operation(path, "render")
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(report.renderedPages, 3)
        self.assertEqual(seen, [1, 2, 3])

    def test_match_searches_whole_pdf_once_and_returns_every_matching_page(self):
        path = self.make_pdf("three.pdf", ["Reference ABC-123", "Different", "Reference ABC-123"])
        seen = []
        original = pymupdf.Page.get_text

        def extract(page, *args, **kwargs):
            seen.append(page.number + 1)
            return original(page, *args, **kwargs)

        with (
            patch.object(pymupdf.Page, "get_pixmap", side_effect=AssertionError("No rendering")),
            patch.object(pymupdf.Page, "get_text", extract),
        ):
            report = validator.run_operation(path, "match", "Reference ABC-123")
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(report.result, "FOUND")
        self.assertEqual(report.matchedPages, [1, 3])
        self.assertEqual(report.searchedPages, 3)
        self.assertEqual(seen, [1, 2, 3])

    def test_each_expected_value_is_a_separate_call(self):
        for text, expected in [
            ("Reference ABC-123", "FOUND"),
            ("Period 2026-08", "FOUND"),
            ("Period 2026-09", "NOT_FOUND"),
        ]:
            code, result = self.run_cli(text=text)
            self.assertEqual(code, 0)
            self.assertEqual(result["result"], expected)

    def test_named_text_and_file_work_in_either_order_without_reading_stdin(self):
        for args in [
            ["match", "--file", str(self.pdf), "--text", "Reference ABC-123"],
            ["match", "--text", "Reference ABC-123", "--file", str(self.pdf)],
        ]:
            with self.subTest(text_first=args[1] == "--text"):
                output, errors = io.StringIO(), io.StringIO()
                with (
                    patch.object(sys, "stdin") as stdin,
                    redirect_stdout(output), redirect_stderr(errors),
                ):
                    code = validator.main(args)
                    stdin.read.assert_not_called()
                    stdin.buffer.read.assert_not_called()
                self.assertEqual(code, 0)
                result = json.loads(output.getvalue())
                self.assertEqual(result["result"], "FOUND")
                self.assertEqual(result["matchedPages"], [1])
                self.assertEqual(errors.getvalue(), "")
                self.assertNotIn("Reference ABC-123", output.getvalue())

    def test_named_file_and_text_are_required_and_errors_do_not_echo_values(self):
        cases = [
            ["match", "--file", str(self.pdf)],
            ["match", "--file", str(self.pdf), "--text", "PRIVATE_VALUE", "--text-stdin"],
            ["match", "--text", "PRIVATE_VALUE"],
            ["inspect"],
            ["render"],
            ["inspect", str(self.pdf)],
            ["match", str(self.pdf), "--text", "PRIVATE_VALUE"],
            ["inspect", "--file", str(self.pdf), "--text", "PRIVATE_VALUE"],
            ["render", "--file", str(self.pdf), "--text-stdin"],
        ]
        for args in cases:
            with self.subTest(command=args[0]):
                output, errors = io.StringIO(), io.StringIO()
                with (
                    patch.object(sys, "stdin") as stdin,
                    redirect_stdout(output), redirect_stderr(errors),
                ):
                    code = validator.main(args)
                    stdin.read.assert_not_called()
                    stdin.buffer.read.assert_not_called()
                self.assertEqual(code, 2)
                self.assertEqual(json.loads(output.getvalue()), {
                    "status": "INCOMPLETE", "warnings": [], "errors": ["INVALID_ARGUMENTS"],
                })
                self.assertEqual(errors.getvalue(), "")
                self.assertNotIn("PRIVATE_VALUE", output.getvalue())
                self.assertNotIn(str(self.pdf), output.getvalue())

    def test_option_like_search_text_is_supported_with_equals(self):
        path = self.make_pdf("option-like.pdf", ["--reference"])
        process = subprocess.run(
            [sys.executable, str(SCRIPT), "match", "--file", str(path), "--text=--reference"],
            capture_output=True, timeout=30,
        )
        self.assertEqual(process.returncode, 0)
        self.assertEqual(process.stderr, b"")
        self.assertEqual(json.loads(process.stdout)["result"], "FOUND")

    def test_match_is_case_sensitive_and_preserves_whitespace(self):
        for text, expected in [
            ("Reference ABC-123", "FOUND"),
            ("  Reference \t ABC-123 \r\n", "NOT_FOUND"),
            ("Reference ABC-123\nPeriod 2026-08", "FOUND"),
            ("Reference ABC-123 Period 2026-08", "NOT_FOUND"),
            ("Reference  ABC-123", "NOT_FOUND"),
            (" Reference ABC-123", "NOT_FOUND"),
            ("Reference ABC-123 ", "NOT_FOUND"),
            ("reference ABC-123", "NOT_FOUND"),
            ("ABC-.*", "NOT_FOUND"),
        ]:
            with self.subTest(text=text):
                code, result = self.run_cli(text=text)
                self.assertEqual(code, 0)
                self.assertEqual(result["result"], expected)

    def test_exact_spaces_newlines_and_tabs_are_accepted_without_rewriting(self):
        page_text = "  Reference  ABC-123\tPeriod\r\n2026-08  "
        for text, expected in [
            ("  Reference  ABC-123", "FOUND"),
            ("ABC-123\tPeriod\r\n2026-08  ", "FOUND"),
            ("Reference ABC-123", "NOT_FOUND"),
            ("ABC-123 Period 2026-08", "NOT_FOUND"),
            ("Period\n2026-08", "NOT_FOUND"),
            ("  ", "FOUND"),
            ("\t", "FOUND"),
            ("\r\n", "FOUND"),
        ]:
            with self.subTest(text=text), patch.object(pymupdf.Page, "get_text", return_value=page_text):
                code, result = self.call_main(text=text)
            self.assertEqual(code, 0)
            self.assertEqual(result["result"], expected)

    def test_argument_with_only_whitespace_is_a_literal_search(self):
        for text in [" ", "\n"]:
            code, result = self.run_cli(text=text)
            self.assertEqual(code, 0)
            self.assertEqual(result["result"], "FOUND")

    def test_text_cannot_match_across_page_boundaries(self):
        path = self.make_pdf("two.pdf", ["Reference", "ABC-123"])
        code, result = self.run_cli(path=path, text="Reference ABC-123")
        self.assertEqual(code, 0)
        self.assertEqual(result["result"], "NOT_FOUND")
        self.assertEqual(result["matchedPages"], [])

    def test_named_text_is_literal_not_a_json_or_batch_protocol(self):
        source = '{"checks":[{"text":"PRIVATE_VALUE","pages":[1]}]}'
        code, result = self.run_cli(text=source)
        self.assertEqual(code, 0)
        self.assertEqual(result["result"], "NOT_FOUND")
        self.assertNotIn("PRIVATE_VALUE", json.dumps(result))

    def test_empty_named_text_is_not_an_implicit_match(self):
        code, result = self.run_cli(text="")
        self.assertEqual(code, 2)
        self.assertEqual(result["result"], "NOT_RUN")
        self.assertEqual(result["errors"], ["TEXT_REQUIRED"])
        self.assertEqual(result["status"], "INCOMPLETE")

    def test_unicode_paths_and_named_text(self):
        path = self.make_pdf("synthetic \u62a5\u544a \u00ae.pdf", ["Caf\u00e9 reference"])
        code, result = self.run_cli(path=path, text="Caf\u00e9")
        self.assertEqual(code, 0)
        self.assertEqual(result["result"], "FOUND")
        self.assertNotIn("Caf", json.dumps(result))

    def test_inspect_and_render_reject_unused_text_in_direct_api(self):
        for operation in ["inspect", "render"]:
            result = validator.run_operation(self.pdf, operation, "Reference")
            self.assertEqual(result.exit_code(), 2)
            self.assertEqual(result.errors, ["TEXT_NOT_APPLICABLE"])
        for text in [None, ""]:
            result = validator.run_operation(self.pdf, "match", text)
            self.assertEqual(result.exit_code(), 2)
            self.assertEqual(result.errors, ["TEXT_REQUIRED"])
        result = validator.run_operation(self.pdf, "PRIVATE_OPERATION")
        self.assertEqual(result.exit_code(), 2)
        self.assertEqual(result.errors, ["INVALID_OPERATION"])
        self.assertNotIn("PRIVATE_OPERATION", str(result))

    def test_removed_flags_and_positional_search_text_are_rejected(self):
        for extra in [
            ["--text-stdin"], ["--options-stdin"], ["--pages", "1"], ["--render-pages", "1"],
            ["--render-dir", str(self.folder)], ["--password", "PRIVATE_VALUE"],
            ["PRIVATE_VALUE"],
        ]:
            code, result = self.run_cli(extra=extra)
            self.assertEqual(code, 2)
            self.assertEqual(result, {
                "status": "INCOMPLETE", "warnings": [], "errors": ["INVALID_ARGUMENTS"],
            })
            self.assertEqual(list(self.folder.iterdir()), [self.pdf])

    def test_missing_operation_does_not_run_a_default_pipeline(self):
        output = io.StringIO()
        with redirect_stdout(output):
            code = validator.main([str(self.pdf)])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["errors"], ["INVALID_ARGUMENTS"])
        self.assertNotIn(str(self.pdf), output.getvalue())

    def test_missing_files_directories_and_invalid_paths_are_input_errors(self):
        for path, expected in [
            (self.folder / "absent.pdf", "FILE_NOT_FOUND"),
            (self.folder, "INPUT_NOT_FILE"),
        ]:
            code, result = self.run_cli("inspect", path)
            self.assertEqual(code, 2)
            self.assertEqual(result["errors"], [expected])
        result = validator.run_operation(Path("PRIVATE_PATH\0.pdf"), "inspect")
        self.assertEqual(result.exit_code(), 2)
        self.assertEqual(result.errors, ["INVALID_PATH"])

    def test_empty_html_broken_and_image_files_are_not_valid_pdfs(self):
        image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
        image.clear_with(255)
        for name, data in [
            ("empty.pdf", b""),
            ("html.pdf", b"<html>PRIVATE_LOGIN_PAGE</html>"),
            ("broken.pdf", b"%PDF-1.7\nincomplete objects"),
            ("image.pdf", image.tobytes("png")),
        ]:
            with self.subTest(name=name):
                path = self.folder / name
                path.write_bytes(data)
                for operation in COMMAND_FIELDS:
                    code, result = self.run_cli(operation, path)
                    self.assertEqual(code, 1)
                    self.assertEqual(result["status"], "FAILED")
                    self.assertTrue(result["errors"])
                    self.assertEqual(set(result), COMMON_FIELDS | COMMAND_FIELDS[operation])
                    self.assertNotIn("PRIVATE_LOGIN_PAGE", json.dumps(result))

    def test_repaired_and_truncated_pdf_are_not_clean_success(self):
        repaired = self.folder / "repaired.pdf"
        repaired.write_bytes(self.pdf.read_bytes().split(b"startxref")[0] + b"startxref\n0\n%%EOF\n")
        code, result = self.run_cli("inspect", repaired)
        self.assertEqual(code, 2)
        self.assertTrue(result["repaired"])
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertIn("PDF_REPAIRED", result["warnings"])
        truncated = self.folder / "truncated.pdf"
        content = self.pdf.read_bytes()
        truncated.write_bytes(content[:len(content) // 2])
        code, result = self.run_cli("inspect", truncated)
        self.assertIn(code, (1, 2))
        self.assertNotEqual(result["status"], "COMPLETE")

    def test_password_metadata_is_reported_and_content_is_not_unlocked(self):
        path = self.make_pdf(
            "locked.pdf", ["Reference ABC-123"],
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw="synthetic-password", owner_pw="synthetic-owner",
        )
        with patch.object(pymupdf.Document, "authenticate", side_effect=AssertionError("No unlock")):
            report = validator.run_operation(path, "inspect")
        self.assertTrue(report.passwordProtected)
        self.assertEqual(report.exit_code(), 2 if report.warnings else 0)
        self.assertEqual(report.errors, [])
        for operation in ["render", "match"]:
            code, result = self.run_cli(operation, path)
            self.assertEqual(code, 2)
            self.assertEqual(result["errors"], ["PASSWORD_PROTECTED"])
            if operation == "match":
                self.assertEqual(result["result"], "NOT_RUN")
            else:
                self.assertEqual(result["renderedPages"], 0)
            self.assertNotIn("synthetic-password", json.dumps(result))

    def test_owner_restrictions_without_an_open_password_do_not_block_operations(self):
        path = self.make_pdf(
            "owner.pdf", ["Reference ABC-123"],
            encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="synthetic-owner", user_pw="",
        )
        for operation in COMMAND_FIELDS:
            code, result = self.run_cli(operation, path)
            self.assertEqual(code, 0)
            self.assertEqual(result["status"], "COMPLETE")

    def test_textless_pages_are_reported_without_claiming_visual_content(self):
        path = self.folder / "image-blank.pdf"
        with pymupdf.open() as document:
            page = document.new_page()
            image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
            image.clear_with(0)
            page.insert_image(pymupdf.Rect(20, 20, 120, 120), stream=image.tobytes("png"))
            document.new_page()
            document.save(path)
        code, rendered = self.run_cli("render", path)
        self.assertEqual(code, 0)
        self.assertEqual(rendered["renderedPages"], 2)
        code, matched = self.run_cli("match", path)
        self.assertEqual(code, 2)
        self.assertEqual(matched["result"], "INCONCLUSIVE")
        self.assertEqual(matched["textlessPages"], [1, 2])
        self.assertEqual(matched["searchedPages"], 2)

    def test_found_text_is_not_invalidated_by_a_blank_page(self):
        path = self.make_pdf("with-blank.pdf", ["Reference ABC-123", ""])
        code, result = self.run_cli(path=path)
        self.assertEqual(code, 0)
        self.assertEqual(result["result"], "FOUND")
        self.assertEqual(result["textlessPages"], [2])
        code, result = self.run_cli(path=path, text="Missing")
        self.assertEqual(code, 2)
        self.assertEqual(result["result"], "INCONCLUSIVE")

    def test_bitmaps_are_released_before_the_next_page_even_after_failure(self):
        path = self.make_pdf("three.pdf", ["First", "Second", "Third"])
        for invalid_first in [False, True]:
            references = []
            original = pymupdf.Page.get_pixmap

            class EmptyBitmap:
                width = 0
                height = 100

            def render(page, **kwargs):
                self.assertFalse(any(ref() is not None for ref in references))
                bitmap = EmptyBitmap() if invalid_first and page.number == 0 else original(page, **kwargs)
                references.append(weakref.ref(bitmap))
                return bitmap

            with patch.object(pymupdf.Page, "get_pixmap", render):
                result = validator.run_operation(path, "render")
            self.assertEqual(result.exit_code(), 1 if invalid_first else 0)
            self.assertEqual(result.renderedPages, 2 if invalid_first else 3)
            self.assertEqual(result.failedPages, [1] if invalid_first else [])
            self.assertEqual(len(references), 3)
            self.assertFalse(any(ref() is not None for ref in references))

    def test_large_page_and_render_memory_failure_are_incomplete(self):
        path = self.folder / "large.pdf"
        with pymupdf.open() as document:
            document.new_page(width=10000, height=10000)
            document.save(path)
        code, result = self.run_cli("render", path)
        self.assertEqual(code, 2)
        self.assertEqual(result["skippedPages"], [1])
        self.assertIn("PAGE_RENDER_LIMIT", result["warnings"])
        with patch.object(pymupdf.Page, "get_pixmap", side_effect=MemoryError):
            code, result = self.call_main("render")
        self.assertEqual(code, 2)
        self.assertEqual(result["failedPages"], [])
        self.assertEqual(result["skippedPages"], [1])
        self.assertIn("PAGE_RENDER_RESOURCE_LIMIT", result["warnings"])

    def test_native_render_error_is_sanitized(self):
        with patch.object(pymupdf.Page, "get_pixmap", side_effect=pymupdf.mupdf.FzErrorFormat("PRIVATE_PDF")):
            code, result = self.call_main("render")
        self.assertEqual(code, 1)
        self.assertEqual(result["failedPages"], [1])
        self.assertIn("PAGE_RENDER_FAILED", result["errors"])

    def test_extraction_failures_return_json(self):
        for mock_options in [
            {"side_effect": RuntimeError("PRIVATE_TEXT")},
            {"side_effect": MemoryError("PRIVATE_TEXT")},
        ]:
            with patch.object(pymupdf.Page, "get_text", **mock_options):
                code, result = self.call_main()
            self.assertEqual(code, 2)
            self.assertEqual(result["result"], "INCONCLUSIVE")
            self.assertEqual(result["failedPages"], [1])
            self.assertEqual(result["searchedPages"], 0)
            self.assertIn("TEXT_SEARCH_FAILED", result["errors"])

    def test_literal_search_memory_failure_returns_json(self):
        class ExhaustedPageText(str):
            def __contains__(self, value):
                raise MemoryError("PRIVATE_SEARCH")

        with patch.object(pymupdf.Page, "get_text", return_value=ExhaustedPageText("Reference")):
            code, result = self.call_main()
        self.assertEqual(code, 2)
        self.assertEqual(result["result"], "INCONCLUSIVE")
        self.assertIn("TEXT_SEARCH_FAILED", result["errors"])

    def test_match_result_allocation_failure_returns_json(self):
        class ExhaustedMatches(list):
            def append(self, value):
                raise MemoryError("PRIVATE_MATCH")

        with patch.dict(validator.RESULT_TYPES, {
            "match": lambda: validator.MatchResult(matchedPages=ExhaustedMatches()),
        }):
            code, result = self.call_main()
        self.assertEqual(code, 2)
        self.assertEqual(result["result"], "INCONCLUSIVE")
        self.assertIn("TEXT_SEARCH_FAILED", result["errors"])

    def test_partial_extraction_failure_retains_matches_but_is_incomplete(self):
        path = self.make_pdf("partial.pdf", ["Reference ABC-123", "Other"])
        original = pymupdf.Page.get_text

        def extract(page, *args, **kwargs):
            if page.number == 1:
                raise MemoryError("PRIVATE_TEXT")
            return original(page, *args, **kwargs)

        with patch.object(pymupdf.Page, "get_text", extract):
            result = validator.run_operation(path, "match", "Reference ABC-123")
        self.assertEqual(result.exit_code(), 2)
        self.assertEqual(result.status, "INCOMPLETE")
        self.assertEqual(result.result, "FOUND")
        self.assertEqual(result.matchedPages, [1])
        self.assertEqual(result.failedPages, [2])

    def test_source_changes_are_reported(self):
        original = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            with self.pdf.open("ab") as output:
                output.write(b"\n")
            return original(page, **kwargs)

        with patch.object(pymupdf.Page, "get_pixmap", render):
            result = validator.run_operation(self.pdf, "render")
        self.assertEqual(result.exit_code(), 2)
        self.assertEqual(result.status, "INCOMPLETE")
        self.assertIn("INPUT_CHANGED_DURING_CHECK", result.errors)

    def test_missing_file_between_stat_and_open_is_an_input_error(self):
        original_open = pymupdf.open

        def remove_then_open(*args, **kwargs):
            self.pdf.unlink()
            return original_open(*args, **kwargs)

        with patch.object(pymupdf, "open", side_effect=remove_then_open):
            code, result = self.call_main("inspect")
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertEqual(result["errors"], ["FILE_NOT_FOUND"])
        self.assertIsNone(result["pages"])

    def test_same_size_and_timestamp_replacement_is_detected(self):
        replacement = self.make_pdf("replacement.pdf", ["Reference XYZ-789\nPeriod 2026-08"])
        size = max(self.pdf.stat().st_size, replacement.stat().st_size)
        for path in (self.pdf, replacement):
            padding = size - path.stat().st_size
            with path.open("ab") as output:
                output.write(b"\n" * padding)
        before = self.pdf.stat()
        self.assertEqual(before.st_size, replacement.stat().st_size)
        os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
        original_close = pymupdf.Document.close

        def close_then_replace(document):
            original_close(document)
            replacement.replace(self.pdf)

        with patch.object(pymupdf.Document, "close", close_then_replace):
            code, result = self.call_main()
        after = self.pdf.stat()
        self.assertEqual(
            (before.st_size, before.st_mtime_ns), (after.st_size, after.st_mtime_ns),
        )
        self.assertNotEqual(before.st_ino, after.st_ino)
        self.assertEqual(result["result"], "FOUND")
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertEqual(result["errors"], ["INPUT_CHANGED_DURING_CHECK"])

    def test_missing_dependency_is_tooling_not_a_bad_pdf(self):
        for operation in COMMAND_FIELDS:
            code, result = self.run_cli(operation, no_site=True)
            self.assertEqual(code, 2)
            self.assertEqual(result["status"], "INCOMPLETE")
            self.assertEqual(result["errors"], ["DEPENDENCY_MISSING"])

    def test_metadata_memory_error_is_sanitized(self):
        with patch.object(pymupdf.Document, "page_count", new_callable=unittest.mock.PropertyMock) as count:
            count.side_effect = MemoryError("PRIVATE_METADATA")
            code, result = self.call_main("inspect")
        self.assertEqual(code, 2)
        self.assertIn("RESOURCE_LIMIT", result["errors"])

    def test_global_and_command_help_are_complete_and_need_no_pdf(self):
        for operation in [None, *COMMAND_FIELDS]:
            command = [sys.executable, str(SCRIPT)]
            if operation:
                command.append(operation)
            command.append("--help")
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=30)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stderr, "")
            if operation:
                for section in ["Input:", "Output JSON:", "Exit codes:", "Example", "diagnostics"]:
                    self.assertIn(section.lower(), result.stdout.lower())
                for field in COMMAND_FIELDS[operation]:
                    self.assertIn(field, result.stdout)
                self.assertIn("--file", result.stdout)
                if operation == "match":
                    self.assertIn("--text TEXT", result.stdout)
                    self.assertNotIn("--text-stdin", result.stdout)
            else:
                for name in COMMAND_FIELDS:
                    self.assertIn(name, result.stdout)
        self.assertEqual(list(self.folder.iterdir()), [self.pdf])


if __name__ == "__main__":
    unittest.main()
