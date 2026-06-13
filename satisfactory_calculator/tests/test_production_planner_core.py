from __future__ import annotations

import sys
import unittest
from pathlib import Path


RECIPE_WEB_DIR = Path(__file__).resolve().parents[1] / "recipe_web"
sys.path.insert(0, str(RECIPE_WEB_DIR))

from production_planner_core import (  # noqa: E402
    MAX_ENABLED_RECIPE_IDS,
    MAX_TARGETS,
    PlannerError,
    ProductionPlanner,
)


class ProductionPlannerCoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.planner = ProductionPlanner.from_excel()

    def test_summary_does_not_expose_local_paths(self) -> None:
        summary = self.planner.summary()

        self.assertNotIn("excelPath", summary)
        self.assertNotIn("sourceDocsJson", summary)
        self.assertGreater(summary["recipeCount"], 0)
        self.assertGreater(summary["itemCount"], 0)

    def test_default_recipes_can_plan_rocket_fuel_targets(self) -> None:
        for item_class in ["Desc_RocketFuel_C", "Desc_Power_Fuel_RocketFuel_C"]:
            with self.subTest(item_class=item_class):
                result = self.planner.plan([{"itemClass": item_class, "rate": 60}])

                self.assertFalse(result.get("recipeExpansionRequired"))
                self.assertEqual(result["summary"]["targetCount"], 1)
                self.assertGreater(result["summary"]["recipeRunCount"], 0)

    def test_empty_recipe_selection_returns_recipe_expansion(self) -> None:
        result = self.planner.plan(
            [{"itemClass": "Desc_IronPlate_C", "rate": 60}],
            enabled_recipe_ids=[],
        )

        self.assertTrue(result["recipeExpansionRequired"])
        self.assertGreater(result["summary"]["requiredRecipeCount"], 0)
        self.assertTrue(result["requiredRecipeIds"])

    def test_rejects_too_many_targets(self) -> None:
        targets = [{"itemClass": "Desc_IronPlate_C", "rate": 1} for _ in range(MAX_TARGETS + 1)]

        with self.assertRaisesRegex(PlannerError, "At most"):
            self.planner.plan(targets)

    def test_rejects_invalid_rates(self) -> None:
        invalid_rates = [float("inf"), float("nan"), -1, 0, 1_000_000.1]

        for rate in invalid_rates:
            with self.subTest(rate=rate):
                with self.assertRaises(PlannerError):
                    self.planner.plan([{"itemClass": "Desc_IronPlate_C", "rate": rate}])

    def test_rejects_too_many_enabled_recipe_ids(self) -> None:
        enabled_recipe_ids = ["Recipe_IronPlate_C"] * (MAX_ENABLED_RECIPE_IDS + 1)

        with self.assertRaisesRegex(PlannerError, "enabledRecipeIds"):
            self.planner.plan(
                [{"itemClass": "Desc_IronPlate_C", "rate": 60}],
                enabled_recipe_ids=enabled_recipe_ids,
            )


if __name__ == "__main__":
    unittest.main()
