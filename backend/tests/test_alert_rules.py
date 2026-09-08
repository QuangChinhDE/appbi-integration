"""Alert rules that reference metrics nobody publishes.

That is the failure this file exists for: a rules file naming a metric the
exporter does not export never fires, and silence looks exactly like health.
It is the most common way a monitoring setup is wrong, and nothing else
detects it -- Prometheus loads such a rule without complaint.

So the metric names in every expression are checked against
`app/api/metrics.py`, and the exporter's own names are checked against the
rules to catch the other direction: a metric that costs a query on every
scrape and that nothing watches.
"""

from __future__ import annotations

import pathlib
import re

import pytest

yaml = pytest.importorskip("yaml")

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
RULES = ROOT / "deploy" / "alerts.yaml"
EXPORTER = ROOT / "backend" / "app" / "api" / "metrics.py"

#: Metrics Prometheus provides itself, so a rule may use them without the
#: product exporting them.
PROMETHEUS_BUILTINS = {"up", "scrape_duration_seconds", "scrape_samples_scraped"}

#: PromQL functions and keywords that look like metric names to a naive regex.
PROMQL_WORDS = {
    "and", "or", "unless", "by", "without", "on", "ignoring", "group_left",
    "group_right", "offset", "bool", "increase", "rate", "irate", "sum",
    "count", "avg", "min", "max", "clamp_min", "clamp_max", "abs", "ceil",
    "floor", "round", "delta", "idelta", "changes", "absent", "absent_over_time",
    "job", "instance", "severity", "component", "version", "environment",
    "humanizeDuration", "value", "labels",
}


@pytest.fixture(scope="module")
def rules() -> list[dict]:
    document = yaml.safe_load(RULES.read_text(encoding="utf-8"))
    return [rule
            for group in document["groups"]
            for rule in group["rules"]]


@pytest.fixture(scope="module")
def exported_metrics() -> set[str]:
    """Every metric name the exporter emits.

    Read from the `# HELP` lines rather than by importing and calling it: the
    exporter needs a database, and this is a pure test. The HELP lines are also
    what Prometheus itself reads, so they are the right source of truth.
    """
    source = EXPORTER.read_text(encoding="utf-8")
    names = set(re.findall(r'"# HELP (\w+)', source))
    assert names, "no # HELP lines found in the exporter"
    return names


def _metric_names(expression: str) -> set[str]:
    """Metric names in a PromQL expression, best-effort."""
    # Strip label matchers, string literals and durations first.
    cleaned = re.sub(r"\{[^}]*\}", " ", expression)
    cleaned = re.sub(r'"[^"]*"', " ", cleaned)
    cleaned = re.sub(r"\[\s*\w+\s*\]", " ", cleaned)
    candidates = set(re.findall(r"\b([a-z_][a-z0-9_]*)\b", cleaned))
    return {name for name in candidates
            if name not in PROMQL_WORDS
            and not name.isdigit()}


class TestEveryRuleReferencesARealMetric:
    def test_the_rules_file_parses(self, rules):
        assert rules, "no rules loaded"

    def test_every_metric_in_every_expression_is_exported(
            self, rules, exported_metrics):
        allowed = exported_metrics | PROMETHEUS_BUILTINS
        unknown: dict[str, set[str]] = {}
        for rule in rules:
            missing = _metric_names(rule["expr"]) - allowed
            if missing:
                unknown[rule["alert"]] = missing
        assert not unknown, (
            "these alerts reference metrics the exporter does not publish, so "
            f"they can never fire: {unknown}. Exported: {sorted(exported_metrics)}")

    def test_every_operational_metric_is_watched_by_a_rule(
            self, rules, exported_metrics):
        """The other direction.

        A metric that costs a database query on every scrape and that no rule
        reads is either a dashboard-only number or an oversight. The
        inventory-style counters are excluded because they are for dashboards
        by design; the health ones are not.
        """
        dashboard_only = {
            "appbi_workflows_total",
            "appbi_workflows_active",
            "appbi_executions_in_flight",
            "appbi_executions_total",
        }
        watched: set[str] = set()
        for rule in rules:
            watched |= _metric_names(rule["expr"])

        unwatched = exported_metrics - watched - dashboard_only
        assert not unwatched, (
            f"these metrics are exported and no alert reads them: {unwatched}. "
            "Either add a rule or add them to `dashboard_only` with a reason.")


class TestRuleQuality:
    def test_every_rule_has_a_severity_and_a_component(self, rules):
        for rule in rules:
            labels = rule.get("labels") or {}
            assert labels.get("severity") in {"critical", "warning"}, rule["alert"]
            assert labels.get("component"), rule["alert"]

    def test_every_rule_says_what_it_means_and_where_to_look(self, rules):
        for rule in rules:
            annotations = rule.get("annotations") or {}
            assert annotations.get("summary"), rule["alert"]
            # An alert that fires at 3am with no explanation of *consequence*
            # gets acknowledged and forgotten.
            description = annotations.get("description", "")
            assert len(description) > 60, (
                f"{rule['alert']} has no real description")
            assert annotations.get("runbook"), (
                f"{rule['alert']} names no runbook; every rule must say where "
                "to look")

    def test_every_runbook_anchor_exists(self, rules):
        runbook = (ROOT / "docs" / "runbooks" / "README.md")
        assert runbook.exists(), "the runbook file every rule points at is missing"
        text = runbook.read_text(encoding="utf-8").lower()
        # Anchors are generated from headings, so the heading text has to be
        # there in some form. Checked loosely -- the point is that the section
        # exists, not that the anchor syntax is perfect.
        missing = []
        for rule in rules:
            anchor = rule["annotations"]["runbook"].split("#", 1)
            if len(anchor) != 2:
                continue
            words = anchor[1].replace("-", " ")
            if words not in text:
                missing.append((rule["alert"], anchor[1]))
        assert not missing, (
            f"these runbook sections do not exist: {missing}")

    def test_every_rule_waits_before_firing(self, rules):
        for rule in rules:
            assert rule.get("for"), (
                f"{rule['alert']} has no `for:` and would fire on a single "
                "scrape -- one slow scrape becomes a page")

    def test_critical_alerts_are_about_the_deployment_not_one_tenant(self, rules):
        """A tenant's own workflow failing must never page an operator.

        Paging for something the operator cannot fix is how a pager gets
        ignored, and the product already tells the tenant (SRS 19).
        """
        critical = [r for r in rules if r["labels"]["severity"] == "critical"]
        assert critical
        for rule in critical:
            expression = rule["expr"]
            assert "appbi_executions_failed" not in expression, (
                f"{rule['alert']} pages on workflow failures, which belong to "
                "the tenant")
