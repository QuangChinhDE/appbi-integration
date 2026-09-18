"""`engine_binding` cannot reach a non-admin response (guardrail 9).

`n8n-nodes-base.httpRequest` is an engine detail, not a product node key --
the FE only ever sees a certified, product-owned node key, and the raw n8n
binding is served to a platform admin only, from the admin router.

`catalog.public_view()` is the one chokepoint every node projection passes
through (`list_nodes`, `get_node`, and by extension every route in
`app/api/v1/nodes.py`), so this is where the leak either does or does not
happen -- these tests exercise that function directly, at its default
argument and explicitly, rather than re-testing the two route handlers that
merely call it.

Previously a "documented-only" invariant (docs/ai-sdlc/ARCHITECTURE_INVARIANTS.md);
this closes it to a mechanical check.
"""

from __future__ import annotations

from app.models.catalog import NodeDefinition
from app.models.enums import Certification, NodeCategory, NodeStatus
from app.services import catalog


def _row() -> NodeDefinition:
    row = NodeDefinition(
        node_key="http_request",
        display_name="HTTP Request",
        category=NodeCategory.ACTION,
        description="Call an external API.",
        icon="globe",
        certification=Certification.SUPPORTED,
        status=NodeStatus.ACTIVE,
        product_schema_version=1,
        config_schema={"fields": []},
        capability_json={"credential_types": ["HTTP_BASIC"]},
        # The exact thing that must never leak: a raw n8n node type/version.
        engine_binding={"engine_type": "n8n-nodes-base.httpRequest",
                         "engine_type_version": 4.1},
        security_profile={},
        docs_ref=None,
        spec_hash="deadbeef",
    )
    return row


class TestPublicViewNeverLeaksTheEngineBinding:
    def test_the_default_call_carries_no_engine_binding_key(self):
        body = catalog.public_view(_row())
        assert "engine_binding" not in body
        # Not just the key: no n8n node-type string appears anywhere in the
        # projection, in case a future field starts embedding it as a string.
        serialized = repr(body)
        assert "n8n-nodes-base" not in serialized

    def test_explicitly_declining_the_binding_also_omits_it(self):
        body = catalog.public_view(_row(), include_binding=False)
        assert "engine_binding" not in body

    def test_admin_view_does_carry_it(self):
        # The escape hatch exists and is intentional -- this proves the
        # *default* is what is being tested above, not that the field is
        # unreachable altogether.
        body = catalog.public_view(_row(), include_binding=True)
        assert body["engine_binding"]["engine_type"] == "n8n-nodes-base.httpRequest"


class TestNonAdminRoutesNeverRequestTheBinding:
    """A route calling `public_view`/`list_nodes`/`get_node` with
    `include_binding=True` on a non-admin path would defeat the test above at
    the one place it matters. `app/api/v1/nodes.py` is small and stable enough
    that reading its two non-admin handlers directly is more honest than a
    regex -- so this reads the router module's source and asserts the
    property by construction: every call to `catalog.get_node` or
    `catalog.list_nodes` outside the `admin_router` block passes
    `include_binding=False` explicitly.
    """

    def test_every_non_admin_catalog_call_declines_the_binding(self):
        import ast
        import inspect

        from app.api.v1 import nodes as nodes_module

        source = inspect.getsource(nodes_module)
        tree = ast.parse(source)

        # Split the module into "before the admin router's routes start" is
        # fragile across reorderings; instead, walk function defs and check
        # which router they are decorated with.
        offences: list[str] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            decorators = [ast.unparse(d) for d in node.decorator_list]
            is_admin_route = any("admin_router" in d for d in decorators)
            if is_admin_route:
                continue
            for call in ast.walk(node):
                if not isinstance(call, ast.Call):
                    continue
                func_name = ast.unparse(call.func)
                if func_name not in ("catalog.get_node", "catalog.list_nodes"):
                    continue
                binding_kwarg = next(
                    (kw for kw in call.keywords if kw.arg == "include_binding"), None)
                if binding_kwarg is None:
                    offences.append(
                        f"{node.name}() calls {func_name} without an explicit "
                        f"include_binding argument -- defaults can change")
                elif ast.unparse(binding_kwarg.value) != "False":
                    offences.append(
                        f"{node.name}() calls {func_name} with "
                        f"include_binding={ast.unparse(binding_kwarg.value)}, "
                        f"not False, and is not an admin route")

        assert not offences, "\n".join(offences)
