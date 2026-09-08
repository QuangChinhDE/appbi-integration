"""The Kubernetes manifests, checked as data rather than reviewed by eye.

A rendered manifest is the deployment. Every property here is one an incident
would otherwise teach us:

* an Ingress path to the engine hands a caller the ability to run a compiled
  graph with none of the product's authorization in front of it (guardrail 15);
* an unpinned image tag means a rollback has nothing to name;
* a service renamed by a release suffix while the ConfigMap that addresses it
  is not -- which happened while these manifests were being written, and would
  have produced a deployment that came up healthy and could not dispatch a
  single run;
* a secret value committed next to the manifests that reference it.

Skipped when `kubectl` is unavailable, because a laptop without it should still
be able to run the backend suite. CI has it.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess

import pytest

yaml = pytest.importorskip("yaml")

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
OVERLAY = ROOT / "deploy" / "kustomize" / "overlays" / "production"

pytestmark = pytest.mark.skipif(
    shutil.which("kubectl") is None,
    reason="kubectl is not installed; the manifest render cannot be checked")


@pytest.fixture(scope="module")
def rendered() -> list[dict]:
    result = subprocess.run(
        ["kubectl", "kustomize", str(OVERLAY)],
        capture_output=True, text=True, timeout=120, cwd=ROOT)
    assert result.returncode == 0, (
        f"the production overlay does not build:\n{result.stderr}")
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def _by_kind(docs: list[dict], kind: str) -> list[dict]:
    return [doc for doc in docs if doc.get("kind") == kind]


def _containers(doc: dict):
    template = (doc.get("spec") or {}).get("template") or {}
    return (template.get("spec") or {}).get("containers", [])


class TestTheEngineIsNotReachable:
    def test_no_ingress_path_leads_to_the_engine(self, rendered):
        backends = [
            path["backend"]["service"]["name"]
            for ingress in _by_kind(rendered, "Ingress")
            for rule in ingress["spec"]["rules"]
            for path in rule["http"]["paths"]
        ]
        assert backends, "the overlay renders no ingress backend at all"
        assert not any("engine" in name for name in backends)

    def test_the_engine_service_is_cluster_ip(self, rendered):
        engines = [s for s in _by_kind(rendered, "Service")
                   if "engine" in s["metadata"]["name"]]
        assert engines
        for service in engines:
            assert service["spec"]["type"] == "ClusterIP"
            # A NodePort or LoadBalancer here would publish it whatever the
            # ingress says.
            for port in service["spec"]["ports"]:
                assert "nodePort" not in port

    def test_a_network_policy_restricts_the_engine_to_api_and_worker(self, rendered):
        policies = {p["metadata"]["name"]: p
                    for p in _by_kind(rendered, "NetworkPolicy")}
        engine = next(p for name, p in policies.items() if "engine" in name)
        sources = [
            list(source["podSelector"]["matchLabels"].values())[0]
            for rule in engine["spec"]["ingress"]
            for source in rule["from"]
        ]
        assert sorted(sources) == ["api", "worker"]

    def test_the_engine_runs_exactly_one_replica(self, rendered):
        """A second engine loses runs, so the manifest may not ask for one.

        Execution state lives in three in-process maps in
        `execution-manager.ts`. The API starts a run, is handed a `ref`, and
        then polls and cancels by that ref -- so behind one Service a second
        replica answers those follow-ups from a pod that has never seen it,
        and a run that is still executing is reported lost.

        This was `replicas: 2`, copied from the API, where two replicas are
        correct by design. Nothing caught it: every other manifest test asks
        about reachability and isolation, and a lost execution is neither.
        """
        engines = [d for d in _by_kind(rendered, "Deployment")
                   if "engine" in d["metadata"]["name"]]
        assert engines, "no engine Deployment in the rendered output"
        for deployment in engines:
            assert deployment["spec"]["replicas"] == 1, (
                "the engine must run one replica until execution state is "
                "either addressable per instance or moved out of the process"
            )

    def test_the_engine_budget_permits_a_drain(self, rendered):
        """`minAvailable: 1` against one replica can never be satisfied.

        Every voluntary eviction is refused, so a node drain blocks forever and
        somebody deletes the pod by hand -- the ungraceful shutdown the budget
        was written to avoid. What protects in-flight runs is ADR-010's crash
        semantics, not a budget that stops the drain.
        """
        budgets = [b for b in _by_kind(rendered, "PodDisruptionBudget")
                   if "engine" in b["metadata"]["name"]]
        assert budgets, "no engine PodDisruptionBudget"
        for budget in budgets:
            assert "minAvailable" not in budget["spec"], (
                "a single-replica workload with minAvailable: 1 cannot be "
                "drained"
            )
            assert budget["spec"]["maxUnavailable"] == 1

    def test_the_engine_may_not_reach_private_networks(self, rendered):
        # Its own egress guard is the first control; this is the second. A
        # workflow that could reach 10.0.0.0/8 could reach the database.
        engine = next(p for p in _by_kind(rendered, "NetworkPolicy")
                      if "engine" in p["metadata"]["name"])
        excluded = [
            cidr
            for rule in engine["spec"]["egress"]
            for target in rule["to"]
            for cidr in (target.get("ipBlock") or {}).get("except", [])
        ]
        for private in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
                        "169.254.0.0/16"):
            assert private in excluded, f"{private} is reachable from the engine"


class TestDefaultDeny:
    def test_there_is_a_policy_that_denies_everything(self, rendered):
        policies = _by_kind(rendered, "NetworkPolicy")
        catch_all = [
            p for p in policies
            if p["spec"].get("podSelector") == {}
            and not p["spec"].get("ingress")
            and not p["spec"].get("egress")
            and set(p["spec"]["policyTypes"]) == {"Ingress", "Egress"}
        ]
        assert catch_all, (
            "without a default-deny policy the others are additions to an "
            "allow-all baseline, which allows everything they do not mention")


class TestReleaseIdentity:
    def test_every_image_is_pinned(self, rendered):
        images = [c["image"] for doc in rendered for c in _containers(doc)]
        assert images
        for image in images:
            assert ":" in image, f"{image} has no tag"
            tag = image.rsplit(":", 1)[1]
            assert tag not in {"latest", "main", "master", "edge", "stable"}, (
                f"{image} is a moving target: a rollback could not name what "
                "it was rolling back to")

    def test_the_three_images_are_one_release(self, rendered):
        tags = {c["image"].rsplit(":", 1)[1]
                for doc in rendered for c in _containers(doc)}
        # The API, the engine and the frontend are one release: a compiler
        # version and a node registry from different builds disagree at
        # runtime, and `certify.py` cannot catch that after the fact.
        assert len(tags) == 1, f"mixed release tags: {sorted(tags)}"

    def test_the_migration_job_is_named_per_release(self, rendered):
        jobs = _by_kind(rendered, "Job")
        assert jobs, "no migration job"
        for job in jobs:
            assert job["metadata"]["name"] != "appbi-workflow-migrate", (
                "a Job is immutable once created, so a fixed name means the "
                "second deploy of a day silently does not migrate")

    def test_the_release_suffix_does_not_rename_the_services(self, rendered):
        """The bug this test exists for.

        A top-level `nameSuffix` renames Services as well as the Job. The
        ConfigMap addresses the engine by service name in an opaque string
        Kustomize does not rewrite, so the API would look for a Service that no
        longer existed -- on a deployment that came up healthy and could not
        dispatch a single run.
        """
        config = next(c for c in _by_kind(rendered, "ConfigMap")
                      if "config" in c["metadata"]["name"])
        services = {s["metadata"]["name"] for s in _by_kind(rendered, "Service")}

        for key in ("ENGINE_BASE_URL", "API_PROXY_TARGET"):
            url = config["data"][key]
            # http://<service>:<port>
            host = url.split("//", 1)[1].split(":", 1)[0]
            assert host in services, (
                f"{key} points at '{host}', which is not the name of any "
                f"rendered Service. Rendered: {sorted(services)}")


class TestResourceGovernance:
    def test_every_container_has_requests_and_limits(self, rendered):
        for doc in rendered:
            for container in _containers(doc):
                resources = container.get("resources") or {}
                where = f"{doc['metadata']['name']}/{container['name']}"
                assert resources.get("requests"), f"{where} has no requests"
                assert resources.get("limits"), f"{where} has no limits"

    def test_memory_is_guaranteed_for_every_container(self, rendered):
        # Memory request equal to limit, so a pod is Guaranteed for the
        # resource it can be OOM-killed for. An engine OOM loses in-flight
        # executions (ADR-010), and the reconciler then has to report them as
        # interrupted.
        for doc in rendered:
            for container in _containers(doc):
                resources = container.get("resources") or {}
                request = resources["requests"].get("memory")
                limit = resources["limits"].get("memory")
                if request and limit:
                    assert request == limit, (
                        f"{doc['metadata']['name']}/{container['name']} is "
                        f"Burstable for memory ({request} vs {limit})")

    def test_the_stateful_components_have_a_disruption_budget(self, rendered):
        """Every component a drain could take out has a budget.

        Either form counts. A multi-replica component says `minAvailable: 1`
        -- keep one answering. A single-replica one has to say
        `maxUnavailable: 1` instead: `minAvailable: 1` there is a budget that
        can never be met, which blocks the drain forever rather than making it
        graceful. Asserting only on `minAvailable` made the correct
        single-replica form look like a missing budget.
        """
        budgets = {b["metadata"]["name"]: b["spec"]
                   for b in _by_kind(rendered, "PodDisruptionBudget")}
        assert budgets, "no PodDisruptionBudget"
        for component in ("api", "engine", "frontend"):
            match = [spec for name, spec in budgets.items() if component in name]
            assert match, f"{component} has no PDB, so a node drain can take it out"
            spec = match[0]
            assert ("minAvailable" in spec) != ("maxUnavailable" in spec), (
                f"{component} must state exactly one of minAvailable / "
                f"maxUnavailable"
            )
            assert spec.get("minAvailable", spec.get("maxUnavailable")) >= 1


class TestHardening:
    def test_the_ingress_terminates_tls(self, rendered):
        for ingress in _by_kind(rendered, "Ingress"):
            assert ingress["spec"].get("tls"), (
                "webhook URLs are built from PUBLIC_BASE_URL and handed to "
                "third parties; those requests carry an HMAC over the body")

    def test_no_container_runs_as_root_or_keeps_capabilities(self, rendered):
        for doc in rendered:
            template = (doc.get("spec") or {}).get("template") or {}
            pod = template.get("spec") or {}
            if not pod.get("containers"):
                continue
            pod_security = pod.get("securityContext") or {}
            name = doc["metadata"]["name"]
            assert pod_security.get("runAsNonRoot") is True, f"{name} may run as root"
            for container in pod["containers"]:
                security = container.get("securityContext") or {}
                where = f"{name}/{container['name']}"
                assert security.get("allowPrivilegeEscalation") is False, where
                assert security.get("readOnlyRootFilesystem") is True, where
                assert security.get("capabilities", {}).get("drop") == ["ALL"], where

    def test_production_configuration_is_set_in_the_manifests(self, rendered):
        config = next(c for c in _by_kind(rendered, "ConfigMap")
                      if "config" in c["metadata"]["name"])
        data = config["data"]
        assert data["APP_ENV"] == "production"
        assert data["SESSION_COOKIE_SECURE"] == "true"
        assert data["ALLOW_DERIVED_ENCRYPTION_KEY"] == "false"
        assert data["EGRESS_ALLOW_PRIVATE_NETWORKS"] == "false"
        # The product must stay readable during an engine outage (SRS 9.6).
        assert data["STARTUP_REQUIRE_ENGINE"] == "false"
        assert data["PUBLIC_BASE_URL"].startswith("https://")

    def test_no_secret_value_is_in_the_manifests(self, rendered):
        # The Secret comes from the cluster's secret manager. A committed value
        # is a value in every clone of this repository, forever.
        rendered_text = yaml.safe_dump_all(rendered)
        for key in ("JWT_SECRET", "SECRET_ENCRYPTION_KEY",
                    "ENGINE_INTERNAL_TOKEN", "DATABASE_URL"):
            assert f"{key}:" not in rendered_text, (
                f"{key} has a value in the rendered manifests")
        assert not _by_kind(rendered, "Secret"), (
            "the overlay renders a Secret; it should reference one the cluster "
            "provides")

    def test_the_secret_is_referenced_by_every_component_that_needs_it(self, rendered):
        for name in ("api", "worker", "migrate"):
            doc = next(d for d in rendered
                       if name in d["metadata"]["name"]
                       and d["kind"] in {"Deployment", "Job"})
            sources = _containers(doc)[0].get("envFrom", [])
            refs = [s["secretRef"]["name"] for s in sources if "secretRef" in s]
            assert refs, f"{name} does not reference the secret"


class TestMonitoringReachability:
    """The alert rules have to be scrapeable, or they are decoration."""

    def test_something_may_scrape_the_api_metrics(self, rendered):
        """A default-deny policy that admits only the frontend blocks Prometheus.

        Every rule in `deploy/alerts.yaml` is written against `/metrics` on the
        API. With ingress limited to the frontend pod, the scrape is refused
        and each rule evaluates on no data — which alerts on nothing and reads
        as health. This asserts there is a second way in.
        """
        policies = [p for p in _by_kind(rendered, "NetworkPolicy")
                    if "api" in p["metadata"]["name"]]
        assert policies, "no NetworkPolicy covers the API"

        sources = [source
                   for policy in policies
                   for rule in policy["spec"].get("ingress", [])
                   for source in rule.get("from", [])]
        assert any("namespaceSelector" in source for source in sources), (
            "only pod-level ingress is allowed, so a monitoring stack in "
            "another namespace cannot scrape /metrics"
        )

    def test_the_worker_alert_reads_the_worker_heartbeat(self):
        """Not the engine probe, which the API also refreshes.

        `appbi_engine_probe_age_seconds` is written by the worker *and* by the
        API's engine-status endpoint, which every browser polls. So it stayed
        fresh while the worker was dead and `AppbiWorkerStopped` could not
        fire as long as one person had a tab open.
        """
        import pathlib
        import yaml

        root = pathlib.Path(__file__).resolve().parent.parent.parent
        rules = yaml.safe_load((root / "deploy" / "alerts.yaml").read_text("utf-8"))
        flat = [rule
                for group in rules["groups"]
                for rule in group["rules"]]
        worker = next(r for r in flat if r.get("alert") == "AppbiWorkerStopped")

        assert "appbi_worker_beat_age_seconds" in worker["expr"]
        assert "appbi_engine_probe_age_seconds" not in worker["expr"]
