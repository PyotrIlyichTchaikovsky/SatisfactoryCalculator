from __future__ import annotations

import json
import sys
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen


RECIPE_WEB_DIR = Path(__file__).resolve().parents[1] / "recipe_web"
sys.path.insert(0, str(RECIPE_WEB_DIR))

from production_planner_server import PlannerRequestHandler  # noqa: E402


class RecordingPlanner:
    def __init__(self) -> None:
        self.call: tuple[tuple[object, ...], dict[str, object]] | None = None

    def plan(self, *args: object, **kwargs: object) -> dict[str, bool]:
        self.call = (args, kwargs)
        return {"ok": True}


class ProductionPlannerServerTests(unittest.TestCase):
    def test_plan_endpoint_forwards_recipe_and_raw_material_selections(self) -> None:
        planner = RecordingPlanner()
        previous_planner = getattr(PlannerRequestHandler, "planner", None)
        PlannerRequestHandler.planner = planner  # type: ignore[assignment]
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            partial(PlannerRequestHandler, directory=str(RECIPE_WEB_DIR)),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        payload = {
            "targets": [{"itemClass": "Desc_Coal_C", "rate": 1}],
            "selectedRecipes": {"Desc_Coal_C": "Recipe_Coal_Iron_C"},
            "enabledRecipeIds": ["Recipe_Coal_Iron_C"],
            "disabledRawMaterialClasses": ["Desc_Coal_C"],
            "preferredPlan": [],
        }
        request = Request(
            f"http://127.0.0.1:{server.server_port}/api/plan",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(request, timeout=5) as response:
                self.assertEqual(json.load(response), {"ok": True})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            if previous_planner is None:
                del PlannerRequestHandler.planner
            else:
                PlannerRequestHandler.planner = previous_planner  # type: ignore[assignment]

        self.assertIsNotNone(planner.call)
        args, kwargs = planner.call
        self.assertEqual(args, (payload["targets"],))
        self.assertEqual(kwargs["selected_recipes"], payload["selectedRecipes"])
        self.assertEqual(kwargs["enabled_recipe_ids"], payload["enabledRecipeIds"])
        self.assertEqual(
            kwargs["disabled_raw_material_classes"],
            payload["disabledRawMaterialClasses"],
        )
        self.assertEqual(kwargs["preferred_plan"], payload["preferredPlan"])


if __name__ == "__main__":
    unittest.main()
