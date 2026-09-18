"""The release gate (`scripts/release_gate.py`).

A gate that can be satisfied by writing "yes" in a form is not a gate, so every
check is either measured or read from a machine-produced report. These tests
pin the ones that would be tempting to soften:

* a missing test report is a failure, not an unknown;
* a suite that reported zero passes did not run;
* an uncommitted working tree cannot be released, because the build is not
  reproducible and a rollback has nothing to name;
* the licence position is always recorded, whatever it says.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


gate = _load("appbi_release_gate", "release_gate.py")


def _evidence(tmp_path: pathlib.Path, **overrides) -> str:
    report = {
        "engine": {"passed": 45, "failed": 0},
        "backend": {"passed": 129, "failed": 0},
        "frontend": {"passed": 32, "failed": 0},
        "e2e": {"passed": 107, "failed": 0},
        "smoke": {"passed": 39, "failed": 0},
    }
    report.update(overrides)
    path = tmp_path / "evidence.json"
    path.write_text(json.dumps(report), encoding="utf-8")
    return str(path)


class TestEvidence:
    def test_a_complete_report_passes(self, tmp_path):
        ok, detail = gate.gate_evidence(_evidence(tmp_path))
        assert ok, detail["problems"]
        assert set(detail["suites"]) == set(gate.REQUIRED_EVIDENCE)

    def test_no_report_at_all_is_a_failure(self):
        # "We did not record whether the tests passed" and "the tests did not
        # pass" have to be treated the same way, or the recording stops
        # happening.
        ok, detail = gate.gate_evidence(None)
        assert not ok
        assert "no --evidence file" in detail["problems"][0]

    def test_a_missing_file_is_a_failure(self, tmp_path):
        ok, detail = gate.gate_evidence(str(tmp_path / "nope.json"))
        assert not ok

    def test_unparseable_json_is_a_failure(self, tmp_path):
        path = tmp_path / "evidence.json"
        path.write_text("{not json", encoding="utf-8")
        ok, detail = gate.gate_evidence(str(path))
        assert not ok
        assert "not valid JSON" in detail["problems"][0]

    @pytest.mark.parametrize("suite", sorted(gate.REQUIRED_EVIDENCE))
    def test_a_missing_suite_is_a_failure(self, tmp_path, suite):
        report = json.loads(pathlib.Path(_evidence(tmp_path)).read_text())
        del report[suite]
        path = tmp_path / "partial.json"
        path.write_text(json.dumps(report), encoding="utf-8")

        ok, detail = gate.gate_evidence(str(path))
        assert not ok
        assert any(suite in problem for problem in detail["problems"])

    def test_a_failing_suite_is_a_failure(self, tmp_path):
        ok, detail = gate.gate_evidence(
            _evidence(tmp_path, e2e={"passed": 100, "failed": 2}))
        assert not ok
        assert "2 failure" in " ".join(detail["problems"])

    def test_a_suite_with_no_passes_did_not_run(self, tmp_path):
        # The subtle one. Zero-and-zero looks like success to a naive check,
        # and means the suite was skipped -- a CI job that silently matched no
        # tests, for instance.
        ok, detail = gate.gate_evidence(
            _evidence(tmp_path, frontend={"passed": 0, "failed": 0}))
        assert not ok
        assert "did not run" in " ".join(detail["problems"])


class TestIdentity:
    def test_a_non_semantic_version_is_refused(self):
        ok, detail = gate.gate_identity("tuesday-build")
        assert not ok
        assert any("semantic version" in p for p in detail["problems"])

    @pytest.mark.parametrize(
        "version", ["1.0.0", "0.1.0", "12.4.7", "1.2.0-rc1", "1.2.0+build7"])
    def test_ordinary_versions_are_accepted(self, version):
        _, detail = gate.gate_identity(version)
        assert not any("semantic version" in p for p in detail["problems"])

    def test_the_artefact_records_what_it_was_built_from(self):
        _, detail = gate.gate_identity("1.2.0")
        # Whether or not this checkout is a git repository, the fields have to
        # be present: an artefact that cannot say what it was built from is not
        # a release artefact.
        for field in ("version", "commit", "branch", "built_at",
                      "working_tree_clean", "image_tag"):
            assert field in detail, field


class TestLegal:
    """The gate has to be able to say no.

    It used to record the licence state and pass either way, which made it
    impossible to *stop* a commercial release -- the only thing a licence gate
    is for. `--delivery` now decides, and `commercial` is the default because
    a SaaS product is a commercial delivery and a gate whose safe answer
    depends on remembering a flag is not a gate.
    """

    def test_a_commercial_release_is_blocked_while_the_review_is_pending(self):
        ok, detail = gate.gate_legal("commercial")
        if detail["commercial_gate"] == "APPROVED":
            pytest.skip("the commercial review has been approved")
        assert not ok, (
            "a commercial delivery passed with commercial_gate="
            f"{detail['commercial_gate']}")
        # And it says how to proceed legitimately, rather than only refusing.
        assert "--delivery internal" in " ".join(detail["problems"])

    def test_an_internal_release_is_allowed_and_records_the_restriction(self):
        ok, detail = gate.gate_legal("internal")
        assert ok
        assert detail["delivery"] == "internal"
        if detail["commercial_gate"] != "APPROVED":
            note = detail["note"].lower()
            # The artefact has to carry the restriction, not just the state.
            for word in ("sold", "hosted", "embedded", "redistributed"):
                assert word in note, f"the note does not mention {word}"

    def test_the_licence_position_is_recorded_either_way(self):
        for delivery in ("commercial", "internal"):
            _, detail = gate.gate_legal(delivery)
            assert detail["commercial_gate"]
            assert detail["delivery"] == delivery

    def test_the_default_delivery_is_the_blocking_one(self):
        """The safe default.

        If somebody adds `--delivery` to a pipeline and forgets it elsewhere,
        the forgotten call site must be the one that refuses.
        """
        import inspect

        source = inspect.getsource(gate.main)
        assert '"--delivery"' in source
        assert 'default="commercial"' in source


class TestSchemaEvidence:
    """A head check is a claim; a drift report is evidence.

    A migration that applies and leaves the schema disagreeing with the models
    passes a head check and then fails at runtime for whichever tenant touches
    the affected column first.
    """

    def _report(self, tmp_path, **overrides) -> str:
        head = gate.gate_schema(None)[1]["head_revision"]
        report = {
            "ok": True,
            "head_revision": head,
            "applied_revision": head,
            "models_match_schema": True,
            "problems": [],
        }
        report.update(overrides)
        path = tmp_path / "drift.json"
        path.write_text(json.dumps(report), encoding="utf-8")
        return str(path)

    def test_a_clean_report_passes(self, tmp_path):
        ok, detail = gate.gate_schema(self._report(tmp_path))
        assert ok, detail["problems"]
        assert detail["drift"]["models_match_schema"] is True

    def test_no_report_is_a_failure(self):
        ok, detail = gate.gate_schema(None)
        assert not ok
        assert "no --drift-report" in " ".join(detail["problems"])

    def test_a_missing_file_is_a_failure(self, tmp_path):
        ok, _ = gate.gate_schema(str(tmp_path / "absent.json"))
        assert not ok

    def test_unparseable_json_is_a_failure(self, tmp_path):
        path = tmp_path / "drift.json"
        path.write_text("{not json", encoding="utf-8")
        ok, detail = gate.gate_schema(str(path))
        assert not ok
        assert "not valid JSON" in " ".join(detail["problems"])

    def test_a_schema_that_does_not_match_the_models_is_a_failure(self, tmp_path):
        path = self._report(
            tmp_path, ok=False, models_match_schema=False,
            problems=["The schema does not match the models: remove_column"])
        ok, detail = gate.gate_schema(path)
        assert not ok
        assert any("does not match the models" in p for p in detail["problems"])

    def test_a_report_from_another_checkout_is_refused(self, tmp_path):
        """Evidence has to describe *this* release.

        A drift report produced against a different head says nothing about
        the migrations being released, and is exactly what a stale CI artefact
        looks like.
        """
        path = self._report(tmp_path, head_revision="deadbeef1234")
        ok, detail = gate.gate_schema(path)
        assert not ok
        assert any("does not describe this release" in p
                   for p in detail["problems"])

    def test_a_database_short_of_its_head_is_refused(self, tmp_path):
        head = gate.gate_schema(None)[1]["head_revision"]
        path = self._report(tmp_path, applied_revision="an-older-revision",
                            head_revision=head)
        ok, detail = gate.gate_schema(path)
        assert not ok
        assert any("not at its head" in p for p in detail["problems"])

    def test_a_single_migration_head_is_still_required(self):
        # The original check, kept: two heads means `alembic upgrade head`
        # would refuse, whatever a drift report says.
        _, detail = gate.gate_schema(None)
        assert detail["head_revision"], "this checkout has no single head"


class TestPinnedRuntime:
    def test_the_n8n_packages_are_pinned_to_one_version(self):
        ok, detail = gate.gate_pinned_runtime()
        assert ok, detail["problems"]
        assert detail["pins"], "compatibility.yaml records no pins"
        # n8n's packages are released as a set and are not independently
        # compatible; a mixed set is a runtime error waiting for the right
        # graph.
        assert len(set(detail["pins"].values())) == 1


class TestOnCall:
    def test_a_release_with_nobody_to_call_is_refused(self, tmp_path, monkeypatch):
        monkeypatch.delenv("ONCALL_CONTACT", raising=False)
        path = tmp_path / "env"
        path.write_text("ONCALL_CONTACT=\n", encoding="utf-8")
        ok, detail = gate.gate_oncall(str(path))
        assert not ok
        assert "escalate" in detail["problems"][0]

    def test_a_named_rota_passes(self, tmp_path, monkeypatch):
        monkeypatch.delenv("ONCALL_CONTACT", raising=False)
        path = tmp_path / "env"
        path.write_text("ONCALL_CONTACT=automation-oncall@example.com\n",
                        encoding="utf-8")
        ok, detail = gate.gate_oncall(str(path))
        assert ok
        assert detail["oncall_contact"] == "automation-oncall@example.com"

    @pytest.mark.parametrize("value", ["FILL_ME", "TBD", "TODO"])
    def test_a_placeholder_is_not_somebody(self, tmp_path, monkeypatch, value):
        monkeypatch.delenv("ONCALL_CONTACT", raising=False)
        path = tmp_path / "env"
        path.write_text(f"ONCALL_CONTACT={value}\n", encoding="utf-8")
        ok, _ = gate.gate_oncall(str(path))
        assert not ok
