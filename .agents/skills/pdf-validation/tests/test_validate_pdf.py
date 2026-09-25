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
DEFAULT_OPTIONS = {"checks": [{"text": "Reference ABC-123", "pages": [1]}]}


class PdfValidationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="pdf-validation-")
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

    def run_cli(
        self, path=None, *, operation="match", options=DEFAULT_OPTIONS, extra=(), no_site=False
    ):
        command = [sys.executable, "-X", "utf8"]
        if no_site:
            command.append("-S")
        command.extend([str(SCRIPT), operation, str(path or self.pdf)])
        if operation == "match" and options is not None:
            command.append("--options-stdin")
        command.extend(extra)
        result = subprocess.run(
            command,
            input=json.dumps(options) if operation == "match" and options is not None else None,
            text=True, encoding="utf-8", capture_output=True, timeout=30,
        )
        self.assertEqual(result.stderr, "", "The CLI must not leak raw diagnostics")
        self.assertEqual(len(result.stdout.splitlines()), 1)
        report = json.loads(result.stdout)
        self.assertNotIn(str(self.folder), result.stdout)
        if report["operation"] is not None:
            self.assertEqual(report["operation"], operation)
        return result.returncode, report

    def test_valid_pdf_is_read_only_and_writes_no_images_or_text(self):
        before = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        code, result = self.run_cli()
        self.assertEqual(code, 0)
        self.assertEqual(result["bytes"], self.pdf.stat().st_size)
        self.assertEqual(result["pages"], 1)
        self.assertEqual(result["parse"], "PASS")
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "FOUND")
        self.assertEqual(result["checks"][0]["matchedPages"], [1])
        self.assertEqual(result["warnings"], [])
        self.assertNotIn("exportedPages", result)
        self.assertEqual(list(self.folder.iterdir()), [self.pdf])
        self.assertNotIn("Reference ABC-123", json.dumps(result))
        self.assertNotIn("Period 2026-08", json.dumps(result))
        self.assertEqual(hashlib.sha256(self.pdf.read_bytes()).hexdigest(), before)

    def test_inspect_only_returns_metadata_without_loading_pages_or_stdin(self):
        with (
            patch.object(pymupdf.Document, "load_page", side_effect=AssertionError("No page loading")),
            patch.object(validator, "read_options", side_effect=AssertionError("No stdin")),
        ):
            report = validator.run_operation(self.pdf, "inspect")
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(report.operation, "inspect")
        self.assertEqual(report.pages, 1)
        self.assertFalse(report.passwordProtected)
        self.assertEqual(report.parse, "PASS")
        self.assertEqual(report.render, "NOT_RUN")
        self.assertEqual(report.contentCheck, "NOT_RUN")
        self.assertEqual(report.checks, [])
        code, result = self.run_cli(operation="inspect", options=None)
        self.assertEqual(code, 0)
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "NOT_RUN")

    def test_render_needs_no_checks_and_does_not_extract_text(self):
        with patch.object(pymupdf.Page, "get_text", side_effect=AssertionError("No extraction")):
            report = validator.run_operation(self.pdf, "render")
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(report.operation, "render")
        self.assertEqual(report.render, "PASS")
        self.assertEqual(report.contentCheck, "NOT_RUN")
        self.assertEqual(report.checks, [])
        code, result = self.run_cli(operation="render", options=None)
        self.assertEqual(code, 0)
        self.assertEqual(result["render"], "PASS")
        self.assertEqual(result["contentCheck"], "NOT_RUN")

    def test_match_extracts_only_requested_pages_without_rendering(self):
        path = self.make_pdf("three.pdf", ["Unselected", "Reference ABC-123", "Unselected"])
        extracted = []
        original = pymupdf.Page.get_text

        def extract(page, *args, **kwargs):
            extracted.append(page.number + 1)
            return original(page, *args, **kwargs)

        with (
            patch.object(pymupdf.Page, "get_pixmap", side_effect=AssertionError("No rendering")),
            patch.object(pymupdf.Page, "get_text", extract),
        ):
            report = validator.run_operation(path, "match", [
                validator.TextCheck("Reference", [2]),
                validator.TextCheck("ABC-123", [2]),
            ])
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(report.operation, "match")
        self.assertEqual(report.render, "NOT_RUN")
        self.assertEqual(report.contentCheck, "FOUND")
        self.assertEqual(extracted, [2])

    def test_operation_specific_arguments_are_not_silently_ignored(self):
        for operation in ["inspect", "render"]:
            code, result = self.run_cli(operation=operation, extra=["--options-stdin"])
            self.assertEqual(code, 2)
            self.assertEqual(result["errors"], ["INVALID_ARGUMENTS"])
            report = validator.run_operation(
                self.pdf, operation, [validator.TextCheck("Reference", [1])],
            )
            self.assertEqual(report.exit_code(), 2)
            self.assertEqual(report.errors, ["CHECKS_NOT_APPLICABLE"])
        report = validator.run_operation(self.pdf, "unsupported")
        self.assertEqual(report.exit_code(), 2)
        self.assertIsNone(report.operation)
        self.assertEqual(report.errors, ["INVALID_OPERATION"])

    def test_operation_must_be_explicit_without_a_default_pipeline(self):
        output, errors = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            code = validator.main([str(self.pdf), "--options-stdin"])
        self.assertEqual(code, 2)
        result = json.loads(output.getvalue())
        self.assertIsNone(result["operation"])
        self.assertEqual(result["parse"], "NOT_RUN")
        self.assertEqual(result["errors"], ["INVALID_ARGUMENTS"])
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn(str(self.pdf), output.getvalue())

    def test_every_page_is_rendered_in_memory_without_encoding_images(self):
        path = self.make_pdf("three.pdf", ["Reference ABC-123", "", "Last page"])
        rendered_pages = []
        original = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            rendered_pages.append(page.number + 1)
            return original(page, **kwargs)

        with (
            patch.object(pymupdf.Page, "get_pixmap", render),
            patch.object(pymupdf.Pixmap, "tobytes", side_effect=AssertionError("No image encoding")),
        ):
            report = validator.run_operation(path, "render")
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(rendered_pages, [1, 2, 3])
        self.assertEqual(report.render, "PASS")
        self.assertEqual(report.contentCheck, "NOT_RUN")
        self.assertEqual(set(self.folder.iterdir()), {self.pdf, path})

    def test_bitmaps_are_released_before_the_next_page(self):
        path = self.make_pdf("three.pdf", ["Reference ABC-123", "", "Last page"])
        bitmap_refs = []
        original_render = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            self.assertFalse(any(ref() is not None for ref in bitmap_refs))
            bitmap = original_render(page, **kwargs)
            bitmap_refs.append(weakref.ref(bitmap))
            return bitmap

        with (
            patch.object(pymupdf.Page, "get_pixmap", render),
            patch.object(pymupdf.Page, "get_text", side_effect=AssertionError("No text extraction")),
        ):
            report = validator.run_operation(path, "render")
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(len(bitmap_refs), 3)
        self.assertFalse(any(ref() is not None for ref in bitmap_refs))

    def test_each_selected_pages_text_is_normalized_only_once(self):
        normalizations = []

        class CountedText(str):
            def split(self, *args, **kwargs):
                normalizations.append(True)
                return super().split(*args, **kwargs)

        with patch.object(pymupdf.Page, "get_text", return_value=CountedText(
            "Reference ABC-123\nPeriod 2026-08"
        )):
            report = validator.run_operation(self.pdf, "match", [
                validator.TextCheck("Reference", [1]),
                validator.TextCheck("ABC-123", [1]),
                validator.TextCheck("Period 2026-08", [1]),
            ])
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(len(normalizations), 1)

    def test_invalid_bitmap_is_released_before_rendering_continues(self):
        path = self.make_pdf("two.pdf", ["First", "Reference ABC-123"])
        bitmap_refs = []
        original_render = pymupdf.Page.get_pixmap

        class EmptyBitmap:
            width = 0
            height = 100

        def render(page, **kwargs):
            self.assertFalse(any(ref() is not None for ref in bitmap_refs))
            bitmap = EmptyBitmap() if page.number == 0 else original_render(page, **kwargs)
            bitmap_refs.append(weakref.ref(bitmap))
            return bitmap

        with patch.object(pymupdf.Page, "get_pixmap", render):
            report = validator.run_operation(path, "render")
        self.assertEqual(report.exit_code(), 1)
        self.assertEqual(report.failedPages, [1])
        self.assertEqual(report.contentCheck, "NOT_RUN")
        self.assertEqual(len(bitmap_refs), 2)
        self.assertFalse(any(ref() is not None for ref in bitmap_refs))

    def test_unicode_paths_and_spaces(self):
        path = self.make_pdf("synthetic \u62a5\u544a \u00ae.pdf", ["Private sample"])
        code, result = self.run_cli(path, options={
            "checks": [{"text": "Private sample", "pages": [1]}],
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["render"], "NOT_RUN")

    def test_blank_and_image_only_pages_render(self):
        path = self.folder / "image-and-blank.pdf"
        with pymupdf.open() as document:
            page = document.new_page()
            image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
            image.clear_with(0)
            page.insert_image(pymupdf.Rect(20, 20, 120, 120), stream=image.tobytes("png"))
            document.new_page()
            document.save(path)
        code, result = self.run_cli(path, operation="render")
        self.assertEqual(code, 0)
        self.assertEqual(result["pages"], 2)
        self.assertEqual(result["render"], "PASS")
        self.assertEqual(result["contentCheck"], "NOT_RUN")
        code, result = self.run_cli(path, options={
            "checks": [{"text": "A reference", "pages": [1, 2]}],
        })
        self.assertEqual(code, 2)
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "INCONCLUSIVE")
        self.assertEqual(set(self.folder.iterdir()), {self.pdf, path})

    def test_content_checks_cannot_be_omitted(self):
        for options in [None, {}, {"checks": []}]:
            with self.subTest(options=options):
                code, result = self.run_cli(options=options)
                self.assertEqual(code, 2)
                self.assertEqual(result["errors"], ["CHECKS_REQUIRED"])
                self.assertEqual(result["contentCheck"], "NOT_RUN")
                self.assertEqual(result["parse"], "NOT_RUN")
                self.assertNotIn("PRIVATE_VALUE", json.dumps(result))

    def test_direct_match_requires_checks(self):
        report = validator.run_operation(self.pdf, "match", [])
        self.assertEqual(report.exit_code(), 2)
        self.assertEqual(report.errors, ["CHECKS_REQUIRED"])
        self.assertEqual(report.parse, "NOT_RUN")

    def test_match_cannot_claim_results_for_unexecuted_checks(self):
        for state in ["NOT_RUN", "INCONCLUSIVE"]:
            with self.subTest(state=state):
                report = validator.Report(operation="match", parse="PASS", contentCheck=state)
                self.assertEqual(report.exit_code(), 2)

    def test_match_reports_each_expectation_without_deciding_workflow_acceptance(self):
        code, result = self.run_cli(options={
            "checks": [
                {"text": "Reference ABC-123", "pages": [1]},
                {"text": "Period 2026-08", "pages": [1]},
            ],
        })
        self.assertEqual(code, 0)
        self.assertEqual([check["result"] for check in result["checks"]], ["FOUND", "FOUND"])
        code, result = self.run_cli(options={
            "checks": [
                {"text": "Reference ABC-123", "pages": [1]},
                {"text": "Period 2026-09", "pages": [1]},
            ],
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["contentCheck"], "NOT_FOUND")
        self.assertEqual([check["result"] for check in result["checks"]], ["FOUND", "NOT_FOUND"])

    def test_page_scoped_text_is_evidence_not_semantic_acceptance(self):
        path = self.make_pdf("scoped.pdf", ["Reference ABC-123", "Other page"])
        code, result = self.run_cli(path, options={
            "checks": [{"text": "Reference   ABC-123", "pages": [1]}],
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["contentCheck"], "FOUND")
        self.assertEqual(result["checks"], [{
            "index": 1, "pages": [1], "result": "FOUND", "matchedPages": [1],
        }])
        self.assertNotIn("ABC-123", json.dumps(result))
        code, result = self.run_cli(path, options={
            "checks": [{"text": "Reference ABC-123", "pages": [2]}],
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["contentCheck"], "NOT_FOUND")
        self.assertEqual(result["parse"], "PASS")
        self.assertEqual(result["render"], "NOT_RUN")

    def test_missing_and_directory_inputs_are_not_pdf_failures(self):
        for path, error in [
            (self.folder / "absent.pdf", "FILE_NOT_FOUND"),
            (self.folder, "INPUT_NOT_FILE"),
        ]:
            with self.subTest(error=error):
                code, result = self.run_cli(path, operation="inspect")
                self.assertEqual(code, 2)
                self.assertEqual(result["parse"], "NOT_RUN")
                self.assertIn(error, result["errors"])

    def test_empty_html_and_broken_pdf_are_rejected(self):
        for name, data in [
            ("empty.pdf", b""),
            ("html.pdf", b"<html>Private login error</html>"),
            ("broken.pdf", b"%PDF-1.7\nincomplete objects"),
        ]:
            with self.subTest(name=name):
                path = self.folder / name
                path.write_bytes(data)
                code, result = self.run_cli(path, operation="inspect")
                self.assertEqual(code, 1)
                self.assertEqual(result["parse"], "FAIL")
                self.assertEqual(result["render"], "NOT_RUN")
                self.assertNotIn("Private login error", json.dumps(result))

    def test_a_supported_non_pdf_format_is_rejected(self):
        path = self.folder / "image.pdf"
        image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
        image.clear_with(255)
        path.write_bytes(image.tobytes("png"))
        code, result = self.run_cli(path, operation="inspect")
        self.assertEqual(code, 1)
        self.assertIn("NOT_PDF", result["errors"])

    def test_repaired_pdf_is_not_a_clean_pass(self):
        path = self.folder / "repaired.pdf"
        path.write_bytes(self.pdf.read_bytes().split(b"startxref")[0] + b"startxref\n0\n%%EOF\n")
        code, result = self.run_cli(path, operation="inspect")
        self.assertEqual(code, 2)
        self.assertEqual(result["parse"], "INCONCLUSIVE")
        self.assertIn("PDF_REPAIRED", result["warnings"])

    def test_truncated_pdf_is_not_a_clean_pass(self):
        path = self.folder / "truncated.pdf"
        content = self.pdf.read_bytes()
        path.write_bytes(content[:len(content) // 2])
        code, result = self.run_cli(path, operation="inspect")
        self.assertIn(code, (1, 2))
        self.assertNotEqual(result["parse"], "PASS")

    def test_inspect_reports_password_protection_without_deciding_acceptance(self):
        path = self.make_pdf(
            "encrypted.pdf", ["Private reference"],
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw="synthetic-password", owner_pw="synthetic-owner",
        )
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        code, result = self.run_cli(path, operation="inspect")
        self.assertEqual(code, 2 if result["warnings"] else 0)
        self.assertIn(result["parse"], ["PASS", "INCONCLUSIVE"])
        self.assertTrue(result["passwordProtected"])
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "NOT_RUN")
        self.assertEqual(result["errors"], [])
        self.assertEqual(list(self.folder.glob("*.png")), [])
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        self.assertNotIn("synthetic-password", json.dumps(result))
        for operation in ["render", "match"]:
            code, result = self.run_cli(path, operation=operation)
            self.assertEqual(code, 2)
            self.assertTrue(result["passwordProtected"])
            self.assertEqual(result["errors"], ["PASSWORD_PROTECTED"])
            self.assertEqual(result["parse"], "PASS")
            self.assertEqual(result["render"], "NOT_RUN")
            self.assertEqual(result["contentCheck"], "NOT_RUN")

    def test_password_options_are_not_accepted(self):
        for password in [None, "", "PRIVATE_VALUE"]:
            with self.subTest(password=password):
                code, result = self.run_cli(options={
                    "checks": DEFAULT_OPTIONS["checks"], "password": password,
                })
                self.assertEqual(code, 2)
                self.assertEqual(result["errors"], ["INVALID_OPTIONS"])
                self.assertEqual(result["parse"], "NOT_RUN")
                self.assertNotIn("PRIVATE_VALUE", json.dumps(result))

    def test_owner_restrictions_without_an_open_password_do_not_prevent_checks(self):
        path = self.make_pdf(
            "owner-restricted.pdf", ["Reference ABC-123"],
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            owner_pw="synthetic-owner", user_pw="",
        )
        code, result = self.run_cli(path)
        self.assertEqual(code, 0)
        self.assertEqual(result["parse"], "PASS")
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertFalse(result["passwordProtected"])
        self.assertEqual(result["contentCheck"], "FOUND")

    def test_invalid_options_are_explicit_and_sanitized(self):
        for options in [
            [], {"unexpected-secret": "PRIVATE_VALUE"}, {"password": 1},
            {"checks": {}}, {"checks": [{"text": "", "pages": [1]}]},
            {"checks": [{"text": "PRIVATE_VALUE", "pages": [0]}]},
            {"checks": [{"text": "PRIVATE_VALUE", "pages": [True]}]},
            {"checks": [{"text": "PRIVATE_VALUE", "pages": [1, 1]}]},
        ]:
            with self.subTest(options=options):
                code, result = self.run_cli(options=options)
                self.assertEqual(code, 2)
                self.assertTrue(result["errors"])
                self.assertNotIn("PRIVATE_VALUE", json.dumps(result))

    def test_invalid_json_is_sanitized(self):
        process = subprocess.run(
            [sys.executable, str(SCRIPT), "match", str(self.pdf), "--options-stdin"],
            input='{"password":"PRIVATE_VALUE",',
            text=True, encoding="utf-8", capture_output=True, timeout=30,
        )
        self.assertEqual(process.returncode, 2)
        self.assertEqual(json.loads(process.stdout)["errors"], ["INVALID_OPTIONS_JSON"])
        self.assertEqual(process.stderr, "")
        self.assertNotIn("PRIVATE_VALUE", process.stdout)

    def test_json_integer_and_nesting_limits_return_input_errors(self):
        sources = [
            '{"checks":[{"text":"PRIVATE_VALUE","pages":[' + "9" * 5000 + "]}]}",
            "[" * 20000 + "0" + "]" * 20000,
        ]
        for source in sources:
            with self.subTest(nested=source.startswith("[")):
                process = subprocess.run(
                    [sys.executable, str(SCRIPT), "match", str(self.pdf), "--options-stdin"],
                    input=source, text=True, encoding="utf-8",
                    env={**os.environ, "PYTHONINTMAXSTRDIGITS": "4300"},
                    capture_output=True, timeout=30,
                )
                self.assertEqual(process.returncode, 2)
                self.assertEqual(process.stderr, "")
                self.assertEqual(len(process.stdout.splitlines()), 1)
                result = json.loads(process.stdout)
                self.assertEqual(result["errors"], ["INVALID_OPTIONS_JSON"])
                self.assertEqual(result["parse"], "NOT_RUN")
                self.assertNotIn("PRIVATE_VALUE", process.stdout)

    def test_stdin_read_failures_are_sanitized_input_errors(self):
        for error, code in [
            (OSError("PRIVATE_INPUT_SOURCE"), "OPTIONS_UNREADABLE"),
            (MemoryError("PRIVATE_INPUT_SOURCE"), "OPTIONS_RESOURCE_LIMIT"),
        ]:
            with self.subTest(code=code):
                output, errors = io.StringIO(), io.StringIO()
                with (
                    patch.object(sys, "stdin") as stdin,
                    redirect_stdout(output),
                    redirect_stderr(errors),
                ):
                    stdin.buffer.read.side_effect = error
                    exit_code = validator.main(["match", str(self.pdf), "--options-stdin"])
                self.assertEqual(exit_code, 2)
                result = json.loads(output.getvalue())
                self.assertEqual(result["errors"], [code])
                self.assertEqual(result["parse"], "NOT_RUN")
                self.assertEqual(errors.getvalue(), "")
                self.assertNotIn("PRIVATE_INPUT_SOURCE", output.getvalue())

    def test_unicode_text_options_accept_utf8_bom(self):
        path = self.make_pdf("unicode-text.pdf", ["Caf\u00e9 reference"])
        process = subprocess.run(
            [sys.executable, "-X", "utf8", str(SCRIPT), "match", str(path), "--options-stdin"],
            input=b"\xef\xbb\xbf" + json.dumps({
                "checks": [{"text": "Caf\u00e9", "pages": [1]}],
            }, ensure_ascii=False).encode("utf-8"),
            capture_output=True, timeout=30,
        )
        self.assertEqual(process.returncode, 0)
        self.assertEqual(process.stderr, b"")
        result = json.loads(process.stdout)
        self.assertEqual(result["contentCheck"], "FOUND")
        self.assertNotIn("Caf", process.stdout.decode("utf-8"))

    def test_page_out_of_range_does_not_silently_skip(self):
        code, result = self.run_cli(options={"checks": [{"text": "Private", "pages": [2]}]})
        self.assertEqual(code, 2)
        self.assertIn("PAGE_OUT_OF_RANGE", result["errors"])
        self.assertEqual(result["contentCheck"], "NOT_RUN")

    def test_image_export_arguments_are_not_supported(self):
        for args in [
            ["--render-pages", "1"],
            ["--render-dir", str(self.folder)],
            ["--render-dir", str(self.folder), "--render-pages", "1"],
        ]:
            with self.subTest(args=args):
                code, result = self.run_cli(extra=args)
                self.assertEqual(code, 2)
                self.assertEqual(result["errors"], ["INVALID_ARGUMENTS"])
                self.assertEqual(result["parse"], "NOT_RUN")
                self.assertNotIn("exportedPages", result)
                self.assertEqual(list(self.folder.iterdir()), [self.pdf])

    def test_render_failure_reports_page_and_no_raw_exception(self):
        path = self.make_pdf("two.pdf", ["First", "Second"])
        original = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            if page.number == 1:
                raise RuntimeError("PRIVATE_DOCUMENT_CONTENT")
            return original(page, **kwargs)

        with patch.object(pymupdf.Page, "get_pixmap", render):
            report = validator.run_operation(path, "render")
        self.assertEqual(report.exit_code(), 1)
        self.assertEqual(report.failedPages, [2])
        self.assertEqual(report.render, "FAIL")
        self.assertNotIn("PRIVATE_DOCUMENT_CONTENT", str(report))

    def test_text_extraction_failure_does_not_claim_pdf_corruption(self):
        with patch.object(pymupdf.Page, "get_text", side_effect=RuntimeError("PRIVATE_TEXT")):
            report = validator.run_operation(
                self.pdf, "match", [validator.TextCheck("Reference", [1])],
            )
        self.assertEqual(report.exit_code(), 2)
        self.assertEqual(report.render, "NOT_RUN")
        self.assertEqual(report.contentCheck, "INCONCLUSIVE")
        self.assertIn("TEXT_EXTRACTION_FAILED", report.warnings)
        self.assertNotIn("PRIVATE_TEXT", str(report))

    def test_text_memory_failure_returns_sanitized_cli_json(self):
        output, errors = io.StringIO(), io.StringIO()
        with (
            patch.object(validator, "read_options", return_value=[
                validator.TextCheck("Reference", [1]),
            ]),
            patch.object(pymupdf.Page, "get_text", side_effect=MemoryError("PRIVATE_TEXT")),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            code = validator.main(["match", str(self.pdf), "--options-stdin"])
        self.assertEqual(code, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "INCONCLUSIVE")
        self.assertIn("TEXT_EXTRACTION_FAILED", result["warnings"])
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn("PRIVATE_TEXT", output.getvalue())

    def test_text_normalization_memory_failure_returns_inconclusive_json(self):
        class ExhaustedText(str):
            def split(self, *args, **kwargs):
                raise MemoryError("PRIVATE_EXTRACTED_TEXT")

        output, errors = io.StringIO(), io.StringIO()
        with (
            patch.object(validator, "read_options", return_value=[
                validator.TextCheck("Reference", [1]),
            ]),
            patch.object(pymupdf.Page, "get_text", return_value=ExhaustedText("Reference")),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            code = validator.main(["match", str(self.pdf), "--options-stdin"])
        self.assertEqual(code, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["parse"], "PASS")
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "INCONCLUSIVE")
        self.assertIn("TEXT_EXTRACTION_FAILED", result["warnings"])
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn("PRIVATE_EXTRACTED_TEXT", output.getvalue())

    def test_matching_memory_failure_preserves_completed_checks(self):
        class ExhaustedExpectedText(str):
            def split(self, *args, **kwargs):
                raise MemoryError("PRIVATE_EXPECTED_TEXT")

        output, errors = io.StringIO(), io.StringIO()
        with (
            patch.object(validator, "read_options", return_value=[
                validator.TextCheck(ExhaustedExpectedText("Reference"), [1]),
            ]),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            code = validator.main(["match", str(self.pdf), "--options-stdin"])
        self.assertEqual(code, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["parse"], "PASS")
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "INCONCLUSIVE")
        self.assertIn("CONTENT_CHECK_RESOURCE_LIMIT", result["errors"])
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn("PRIVATE_EXPECTED_TEXT", output.getvalue())

    def test_native_mupdf_error_is_sanitized(self):
        error = pymupdf.mupdf.FzErrorFormat("PRIVATE_DOCUMENT_CONTENT")
        with patch.object(pymupdf.Page, "get_pixmap", side_effect=error):
            report = validator.run_operation(self.pdf, "render")
        self.assertEqual(report.exit_code(), 1)
        self.assertEqual(report.failedPages, [1])
        self.assertIn("PAGE_RENDER_FAILED", report.errors)
        self.assertNotIn("PRIVATE_DOCUMENT_CONTENT", str(report))

    def test_render_memory_failure_is_incomplete_not_bad_pdf(self):
        with patch.object(pymupdf.Page, "get_pixmap", side_effect=MemoryError):
            report = validator.run_operation(self.pdf, "render")
        self.assertEqual(report.exit_code(), 2)
        self.assertEqual(report.render, "INCONCLUSIVE")
        self.assertEqual(report.skippedPages, [1])
        self.assertEqual(report.failedPages, [])

    def test_input_changes_during_inspection_are_detected(self):
        original = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            with self.pdf.open("ab") as output:
                output.write(b"\n")
            return original(page, **kwargs)

        with patch.object(pymupdf.Page, "get_pixmap", render):
            report = validator.run_operation(self.pdf, "render")
        self.assertEqual(report.exit_code(), 2)
        self.assertIn("INPUT_CHANGED_DURING_CHECK", report.errors)

    def test_large_page_is_incomplete_not_passed(self):
        path = self.folder / "large.pdf"
        with pymupdf.open() as document:
            document.new_page(width=10000, height=10000)
            document.save(path)
        code, result = self.run_cli(path, operation="render")
        self.assertEqual(code, 2)
        self.assertEqual(result["render"], "INCONCLUSIVE")
        self.assertEqual(result["skippedPages"], [1])
        self.assertIn("PAGE_RENDER_LIMIT", result["warnings"])

    def test_missing_dependency_is_reported_as_tooling_not_bad_pdf(self):
        code, result = self.run_cli(no_site=True)
        self.assertEqual(code, 2)
        self.assertEqual(result["errors"], ["DEPENDENCY_MISSING"])
        self.assertEqual(result["parse"], "NOT_RUN")

    def test_invalid_cli_arguments_do_not_echo_values(self):
        code, result = self.run_cli(extra=["--unknown-private-option", "PRIVATE_VALUE"])
        self.assertEqual(code, 2)
        self.assertEqual(result["errors"], ["INVALID_ARGUMENTS"])
        self.assertNotIn("PRIVATE_VALUE", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
