from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

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

    def run_cli(self, path=None, *, options=DEFAULT_OPTIONS, extra=(), no_site=False):
        command = [sys.executable, "-X", "utf8"]
        if no_site:
            command.append("-S")
        command.extend([str(SCRIPT), str(path or self.pdf)])
        if options is not None:
            command.append("--options-stdin")
        command.extend(extra)
        result = subprocess.run(
            command,
            input=json.dumps(options) if options is not None else None,
            text=True, encoding="utf-8", capture_output=True, timeout=30,
        )
        self.assertEqual(result.stderr, "", "The CLI must not leak raw diagnostics")
        self.assertEqual(len(result.stdout.splitlines()), 1)
        report = json.loads(result.stdout)
        self.assertNotIn(str(self.folder), result.stdout)
        return result.returncode, report

    def test_valid_pdf_is_read_only_and_exports_nothing_by_default(self):
        before = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        code, result = self.run_cli()
        self.assertEqual(code, 0)
        self.assertEqual(result["bytes"], self.pdf.stat().st_size)
        self.assertEqual(result["pages"], 1)
        self.assertEqual(result["parse"], "PASS")
        self.assertEqual(result["render"], "PASS")
        self.assertEqual(result["contentCheck"], "FOUND")
        self.assertEqual(result["checks"][0]["matchedPages"], [1])
        self.assertEqual(result["warnings"], [])
        self.assertEqual(result["exportedPages"], [])
        self.assertEqual(list(self.folder.glob("*.png")), [])
        self.assertEqual(hashlib.sha256(self.pdf.read_bytes()).hexdigest(), before)

    def test_unicode_paths_and_spaces(self):
        path = self.make_pdf("synthetic \u62a5\u544a \u00ae.pdf", ["Private sample"])
        code, result = self.run_cli(path, options={
            "checks": [{"text": "Private sample", "pages": [1]}],
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["render"], "PASS")

    def test_blank_and_image_only_pages_render(self):
        path = self.folder / "image-and-blank.pdf"
        with pymupdf.open() as document:
            page = document.new_page()
            image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
            image.clear_with(0)
            page.insert_image(pymupdf.Rect(20, 20, 120, 120), stream=image.tobytes("png"))
            document.new_page()
            document.save(path)
        code, result = self.run_cli(path)
        self.assertEqual(code, 2)
        self.assertEqual(result["pages"], 2)
        self.assertEqual(result["render"], "PASS")
        self.assertEqual(result["contentCheck"], "INCONCLUSIVE")
        output = self.folder / "private-images"
        output.mkdir()
        code, result = self.run_cli(path, options={
            "checks": [{"text": "A reference", "pages": [1, 2]}],
        }, extra=["--render-dir", str(output), "--render-pages", "1"])
        self.assertEqual(code, 2)
        self.assertEqual(result["render"], "PASS")
        self.assertEqual(result["contentCheck"], "INCONCLUSIVE")
        self.assertEqual(result["exportedPages"], [1])
        self.assertTrue((output / "page-0001.png").is_file())

    def test_content_checks_cannot_be_omitted(self):
        for options in [None, {}, {"checks": []}]:
            with self.subTest(options=options):
                code, result = self.run_cli(options=options)
                self.assertEqual(code, 2)
                self.assertEqual(result["errors"], ["CHECKS_REQUIRED"])
                self.assertEqual(result["contentCheck"], "NOT_RUN")
                self.assertEqual(result["parse"], "NOT_RUN")
                self.assertNotIn("PRIVATE_VALUE", json.dumps(result))

    def test_direct_inspection_requires_checks_too(self):
        report = validator.inspect_pdf(self.pdf, [], None, [])
        self.assertEqual(report.exit_code(), 2)
        self.assertEqual(report.errors, ["CHECKS_REQUIRED"])
        self.assertEqual(report.parse, "NOT_RUN")

    def test_rendering_alone_cannot_return_success(self):
        for state in ["NOT_RUN", "INCONCLUSIVE", "NOT_FOUND", "NOT_REQUESTED"]:
            with self.subTest(state=state):
                report = validator.Report(parse="PASS", render="PASS", contentCheck=state)
                self.assertEqual(report.exit_code(), 2)

    def test_every_required_text_check_must_be_found(self):
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
        self.assertEqual(code, 2)
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
        self.assertEqual(code, 2)
        self.assertEqual(result["contentCheck"], "NOT_FOUND")
        self.assertEqual(result["parse"], "PASS")
        self.assertEqual(result["render"], "PASS")

    def test_missing_and_directory_inputs_are_not_pdf_failures(self):
        for path, error in [
            (self.folder / "absent.pdf", "FILE_NOT_FOUND"),
            (self.folder, "INPUT_NOT_FILE"),
        ]:
            with self.subTest(error=error):
                code, result = self.run_cli(path)
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
                code, result = self.run_cli(path)
                self.assertEqual(code, 1)
                self.assertEqual(result["parse"], "FAIL")
                self.assertEqual(result["render"], "NOT_RUN")
                self.assertNotIn("Private login error", json.dumps(result))

    def test_a_supported_non_pdf_format_is_rejected(self):
        path = self.folder / "image.pdf"
        image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
        image.clear_with(255)
        path.write_bytes(image.tobytes("png"))
        code, result = self.run_cli(path)
        self.assertEqual(code, 1)
        self.assertIn("NOT_PDF", result["errors"])

    def test_repaired_pdf_is_not_a_clean_pass(self):
        path = self.folder / "repaired.pdf"
        path.write_bytes(self.pdf.read_bytes().split(b"startxref")[0] + b"startxref\n0\n%%EOF\n")
        code, result = self.run_cli(path)
        self.assertEqual(code, 2)
        self.assertEqual(result["parse"], "INCONCLUSIVE")
        self.assertIn("PDF_REPAIRED", result["warnings"])

    def test_truncated_pdf_is_not_a_clean_pass(self):
        path = self.folder / "truncated.pdf"
        content = self.pdf.read_bytes()
        path.write_bytes(content[:len(content) // 2])
        code, result = self.run_cli(path)
        self.assertIn(code, (1, 2))
        self.assertNotEqual(result["parse"], "PASS")

    def test_password_protected_pdf_fails_without_unlocking_or_exporting(self):
        path = self.make_pdf(
            "encrypted.pdf", ["Private reference"],
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw="synthetic-password", owner_pw="synthetic-owner",
        )
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        code, result = self.run_cli(
            path, extra=["--render-dir", str(self.folder), "--render-pages", "1"],
        )
        self.assertEqual(code, 1)
        self.assertEqual(result["parse"], "FAIL")
        self.assertEqual(result["render"], "NOT_RUN")
        self.assertEqual(result["contentCheck"], "NOT_RUN")
        self.assertEqual(result["errors"], ["PASSWORD_PROTECTED"])
        self.assertEqual(result["exportedPages"], [])
        self.assertEqual(list(self.folder.glob("*.png")), [])
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        self.assertNotIn("synthetic-password", json.dumps(result))

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
        self.assertEqual(result["render"], "PASS")
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
            [sys.executable, str(SCRIPT), str(self.pdf), "--options-stdin"],
            input='{"password":"PRIVATE_VALUE",',
            text=True, encoding="utf-8", capture_output=True, timeout=30,
        )
        self.assertEqual(process.returncode, 2)
        self.assertEqual(json.loads(process.stdout)["errors"], ["INVALID_OPTIONS_JSON"])
        self.assertEqual(process.stderr, "")
        self.assertNotIn("PRIVATE_VALUE", process.stdout)

    def test_unicode_text_options_accept_utf8_bom(self):
        path = self.make_pdf("unicode-text.pdf", ["Caf\u00e9 reference"])
        process = subprocess.run(
            [sys.executable, "-X", "utf8", str(SCRIPT), str(path), "--options-stdin"],
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

    def test_exports_only_selected_pages_without_overwriting(self):
        path = self.make_pdf("three.pdf", ["Page one", "", "Page three"])
        output = self.folder / "private-render"
        output.mkdir()
        args = ["--render-dir", str(output), "--render-pages", "1", "3"]
        options = {"checks": [{"text": "Page one", "pages": [1]}]}
        code, result = self.run_cli(path, options=options, extra=args)
        self.assertEqual(code, 0)
        self.assertEqual(result["exportedPages"], [1, 3])
        self.assertEqual(sorted(p.name for p in output.iterdir()), ["page-0001.png", "page-0003.png"])
        first = (output / "page-0001.png").read_bytes()
        self.assertTrue(first.startswith(b"\x89PNG"))
        code, result = self.run_cli(path, options=options, extra=args)
        self.assertEqual(code, 2)
        self.assertIn("EXPORT_EXISTS", result["errors"])
        self.assertEqual((output / "page-0001.png").read_bytes(), first)

    def test_export_arguments_must_be_complete_and_valid(self):
        for args in [
            ["--render-pages", "1"],
            ["--render-dir", str(self.folder)],
            ["--render-dir", str(self.folder / "absent"), "--render-pages", "1"],
            ["--render-dir", str(self.folder), "--render-pages", "2"],
            ["--render-dir", str(self.folder), "--render-pages", "-1"],
        ]:
            with self.subTest(args=args):
                code, result = self.run_cli(extra=args)
                self.assertEqual(code, 2)
                self.assertTrue(result["errors"])
                self.assertEqual(result["exportedPages"], [])

    def test_render_failure_reports_page_and_no_raw_exception(self):
        path = self.make_pdf("two.pdf", ["First", "Second"])
        original = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            if page.number == 1:
                raise RuntimeError("PRIVATE_DOCUMENT_CONTENT")
            return original(page, **kwargs)

        with patch.object(pymupdf.Page, "get_pixmap", render):
            report = validator.inspect_pdf(
                path, [validator.TextCheck("First", [1])], None, [],
            )
        self.assertEqual(report.exit_code(), 1)
        self.assertEqual(report.failedPages, [2])
        self.assertEqual(report.render, "FAIL")
        self.assertNotIn("PRIVATE_DOCUMENT_CONTENT", str(report))

    def test_text_extraction_failure_does_not_claim_pdf_corruption(self):
        with patch.object(pymupdf.Page, "get_text", side_effect=RuntimeError("PRIVATE_TEXT")):
            report = validator.inspect_pdf(
                self.pdf, [validator.TextCheck("Reference", [1])], None, [],
            )
        self.assertEqual(report.exit_code(), 2)
        self.assertEqual(report.render, "PASS")
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
            code = validator.main([str(self.pdf), "--options-stdin"])
        self.assertEqual(code, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["render"], "PASS")
        self.assertEqual(result["contentCheck"], "INCONCLUSIVE")
        self.assertIn("TEXT_EXTRACTION_FAILED", result["warnings"])
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn("PRIVATE_TEXT", output.getvalue())

    def test_png_memory_failure_returns_sanitized_cli_json(self):
        output, errors = io.StringIO(), io.StringIO()
        with (
            patch.object(validator, "read_options", return_value=[
                validator.TextCheck("Reference", [1]),
            ]),
            patch.object(pymupdf.Pixmap, "tobytes", side_effect=MemoryError("PRIVATE_IMAGE")),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            code = validator.main([
                str(self.pdf), "--options-stdin",
                "--render-dir", str(self.folder), "--render-pages", "1",
            ])
        self.assertEqual(code, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["render"], "PASS")
        self.assertEqual(result["contentCheck"], "FOUND")
        self.assertIn("PAGE_EXPORT_FAILED", result["errors"])
        self.assertEqual(result["exportedPages"], [])
        self.assertEqual(list(self.folder.glob("*.png")), [])
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn("PRIVATE_IMAGE", output.getvalue())

    def test_native_mupdf_error_is_sanitized(self):
        error = pymupdf.mupdf.FzErrorFormat("PRIVATE_DOCUMENT_CONTENT")
        with patch.object(pymupdf.Page, "get_pixmap", side_effect=error):
            report = validator.inspect_pdf(
                self.pdf, [validator.TextCheck("Reference", [1])], None, [],
            )
        self.assertEqual(report.exit_code(), 1)
        self.assertEqual(report.failedPages, [1])
        self.assertIn("PAGE_RENDER_FAILED", report.errors)
        self.assertNotIn("PRIVATE_DOCUMENT_CONTENT", str(report))

    def test_render_memory_failure_is_incomplete_not_bad_pdf(self):
        with patch.object(pymupdf.Page, "get_pixmap", side_effect=MemoryError):
            report = validator.inspect_pdf(
                self.pdf, [validator.TextCheck("Reference", [1])], None, [],
            )
        self.assertEqual(report.exit_code(), 2)
        self.assertEqual(report.render, "INCONCLUSIVE")
        self.assertEqual(report.skippedPages, [1])
        self.assertEqual(report.failedPages, [])

    def test_export_failure_is_reported_without_exposing_paths(self):
        with patch.object(Path, "open", side_effect=PermissionError("PRIVATE_PATH")):
            report = validator.inspect_pdf(
                self.pdf, [validator.TextCheck("Reference", [1])], self.folder, [1],
            )
        self.assertEqual(report.exit_code(), 2)
        self.assertIn("PAGE_EXPORT_FAILED", report.errors)
        self.assertEqual(report.exportedPages, [])
        self.assertNotIn("PRIVATE_PATH", str(report))

    def test_input_changes_during_inspection_are_detected(self):
        original = pymupdf.Page.get_pixmap

        def render(page, **kwargs):
            with self.pdf.open("ab") as output:
                output.write(b"\n")
            return original(page, **kwargs)

        with patch.object(pymupdf.Page, "get_pixmap", render):
            report = validator.inspect_pdf(
                self.pdf, [validator.TextCheck("Reference", [1])], None, [],
            )
        self.assertEqual(report.exit_code(), 2)
        self.assertIn("INPUT_CHANGED_DURING_CHECK", report.errors)

    def test_large_page_is_incomplete_not_passed(self):
        path = self.folder / "large.pdf"
        with pymupdf.open() as document:
            document.new_page(width=10000, height=10000)
            document.save(path)
        code, result = self.run_cli(path)
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
