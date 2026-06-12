from __future__ import annotations

import re
import sys
import warnings
import zipfile
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree as ET

try:
    from scipy.optimize import Bounds, LinearConstraint, linprog, milp
except ImportError:  # pragma: no cover - handled at runtime with a clear planner error.
    Bounds = None
    LinearConstraint = None
    linprog = None
    milp = None


DEFAULT_EXCEL_PATH = Path(__file__).resolve().parent / "data" / "Data.xlsx"

_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_COLUMN_RE = re.compile(r"[A-Z]+")
_CELL_REF_RE = re.compile(r"([A-Z]+)(\d+)")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_LP_EPS = 1e-7
_RESULT_EPS = 1e-5
_DIRECT_RAW_RECIPE_ID = "__raw__"
_RAW_PLAN_NODE_PREFIX = "RAW:"
_PREFERRED_KEEP_MIN_RATIO = 0.98
_RECIPE_MODE_BASE = "base"
_RECIPE_MODE_BEST_EFFICIENCY = "bestEfficiency"
_MATERIAL_CATEGORY_RAW = "RawMaterial"
_MATERIAL_CATEGORY_PICKUP = "PickupMaterial"
_MATERIAL_CATEGORY_NORMAL = "NormalMaterial"
_MATERIAL_CATEGORY_POWER = "Power"
_RECIPE_FLAG_PACKAGE = "Package"
_RECIPE_FLAG_UNPACKAGE = "Unpackage"
_RECIPE_FLAG_RAW_MATERIAL = "RawMaterial"
_RECIPE_FLAG_POWER = "PowerRecipe"
_MILP_STRICT_OPTIONS = {"mip_feasibility_tolerance": 1e-9}


class PlannerError(ValueError):
    """Raised when planner input or source data is invalid."""


@dataclass(frozen=True)
class Item:
    class_name: str
    name: str
    unit: str
    form: str
    material_category: str
    is_raw_resource: bool
    producible: bool
    icon_path: str = ""


@dataclass(frozen=True)
class Ingredient:
    item_class: str
    item_name: str
    amount: float
    unit: str
    per_min: float


@dataclass(frozen=True)
class Recipe:
    recipe_id: str
    name: str
    is_alternate: bool
    flags: tuple[str, ...]
    produced_in: tuple[str, ...]
    produced_in_classes: tuple[str, ...]
    duration_sec: float
    inputs: tuple[Ingredient, ...]
    outputs: tuple[Ingredient, ...]


@dataclass(frozen=True)
class RecipeChoice:
    recipe: Recipe
    output: Ingredient


@dataclass(frozen=True)
class ReplacementGroup:
    item_class: str
    item_name: str
    recipe_ids: tuple[str, ...]
    base_recipe_ids: tuple[str, ...]


@dataclass(frozen=True)
class MaterialRecipeGroup:
    item_class: str
    item_name: str
    material_category: str
    recipe_ids: tuple[str, ...]


@dataclass(frozen=True)
class PowerGroup:
    group_class: str
    group_name: str
    member_classes: tuple[str, ...]
    member_names: tuple[str, ...]


@dataclass(frozen=True)
class _ItemInfo:
    class_name: str
    display_name: str
    form: str
    unit: str
    native_class: str
    material_category: str = ""
    icon_path: str = ""


@dataclass(frozen=True)
class _DeviceInfo:
    class_name: str
    name: str
    icon_path: str


class ProductionPlanner:
    def __init__(
        self,
        excel_path: Path,
        items: dict[str, Item],
        recipes: tuple[Recipe, ...],
        raw_source_classes: set[str],
        pickup_source_classes: set[str],
        material_recipe_groups: tuple[MaterialRecipeGroup, ...],
        replacement_groups: tuple[ReplacementGroup, ...],
        power_groups: tuple[PowerGroup, ...],
        devices: dict[str, _DeviceInfo],
        version_info: dict[str, Any],
    ) -> None:
        self.excel_path = excel_path
        self.items = items
        self.recipes = recipes
        self.recipes_by_id = {recipe.recipe_id: recipe for recipe in recipes}
        self.version_info = version_info
        self.recipes_by_output = self._build_recipes_by_output(recipes)
        self.material_recipe_groups = material_recipe_groups
        self.replacement_groups = replacement_groups
        self.devices = devices
        self.replacement_groups_by_item = {group.item_class: group for group in replacement_groups}
        self.selectable_recipe_ids = {
            recipe.recipe_id
            for recipe in recipes
            if not _recipe_has_flag(recipe, _RECIPE_FLAG_UNPACKAGE)
        }
        self.default_enabled_recipe_ids = {
            recipe_id
            for group in replacement_groups
            for recipe_id in group.base_recipe_ids
            if recipe_id in self.selectable_recipe_ids
        }
        self.power_groups = power_groups
        self.power_groups_by_class = {group.group_class: group for group in power_groups}
        self.power_groups_by_member = {
            member_class: group
            for group in power_groups
            for member_class in group.member_classes
        }
        for group in power_groups:
            existing_group_item = self.items.get(group.group_class)
            self.items[group.group_class] = (
                Item(
                    class_name=group.group_class,
                    name=existing_group_item.name if existing_group_item else group.group_name,
                    unit=(existing_group_item.unit if existing_group_item else "MW") or "MW",
                    form=(existing_group_item.form if existing_group_item else "RF_POWER") or "RF_POWER",
                    material_category=existing_group_item.material_category if existing_group_item else _MATERIAL_CATEGORY_POWER,
                    is_raw_resource=False,
                    producible=True,
                    icon_path=existing_group_item.icon_path if existing_group_item else "",
                )
            )
        self.primary_output_by_recipe = {
            recipe.recipe_id: recipe.outputs[0].item_class
            for recipe in recipes
            if recipe.outputs
        }
        self.replacement_group_by_recipe = {
            recipe_id: group
            for group in replacement_groups
            for recipe_id in group.recipe_ids
        }
        self.output_classes = {
            output.item_class
            for recipe in recipes
            for output in recipe.outputs
        }
        self.raw_source_classes = set(raw_source_classes)
        self.pickup_source_classes = set(pickup_source_classes)
        self.external_source_classes = self.raw_source_classes | self.pickup_source_classes
        self.items_list = sorted(
            items.values(),
            key=lambda item: (not item.producible, item.name.lower(), item.class_name),
        )

    @classmethod
    def from_excel(cls, excel_path: str | Path = DEFAULT_EXCEL_PATH) -> "ProductionPlanner":
        path = Path(excel_path).expanduser().resolve()
        sheets = _load_xlsx_sheets(path)
        required_sheets = {"Materials", "RecipesLong", "RecipeInputs", "RecipeOutputs"}
        missing = sorted(required_sheets - set(sheets))
        if missing:
            raise PlannerError(f"Excel workbook is missing required sheets: {', '.join(missing)}")

        item_infos = _load_material_infos(sheets["Materials"])
        inputs_by_recipe, input_item_names = _load_recipe_io(sheets["RecipeInputs"])
        outputs_by_recipe, output_item_names = _load_recipe_io(sheets["RecipeOutputs"])
        recipes = _load_recipes(sheets["RecipesLong"], inputs_by_recipe, outputs_by_recipe)
        devices = _load_devices(sheets.get("Devices", []))
        version_info = _load_key_value_sheet(sheets.get("VersionInfo", []))
        power_groups = _load_power_groups(sheets.get("PowerGroup", []))

        item_names = _build_item_names(item_infos, input_item_names, output_item_names)
        used_classes = _planner_item_classes(item_infos, input_item_names, output_item_names)
        output_classes = set(output_item_names)
        material_categories = _derive_material_categories(used_classes, item_infos, output_classes)
        raw_source_classes, pickup_source_classes = _source_classes_from_categories(material_categories)
        material_recipe_groups = _build_material_recipe_groups(recipes, item_names, material_categories)
        replacement_groups = _build_replacement_groups(recipes, item_names, material_categories)
        producible_classes = output_classes & used_classes
        items = _build_items(used_classes, producible_classes, item_names, item_infos, material_categories)
        return cls(
            path,
            items,
            recipes,
            raw_source_classes,
            pickup_source_classes,
            material_recipe_groups,
            replacement_groups,
            power_groups,
            devices,
            version_info,
        )

    def summary(self) -> dict[str, Any]:
        return {
            "recipeCount": len(self.recipes),
            "itemCount": len(self.items),
            "rawMaterialCount": len(self.raw_source_classes),
            "pickupMaterialCount": len(self.pickup_source_classes),
            "powerGroupCount": len(self.power_groups),
            "excelPath": str(self.excel_path),
            "sourceDocsJson": self.version_info.get("SourceDocsJson", ""),
            "generatedAt": self.version_info.get("GeneratedAt", ""),
        }

    def list_items(self) -> list[dict[str, Any]]:
        return [self._item_to_dict(item) for item in self.items_list]

    def list_recipes(self) -> dict[str, Any]:
        materials: list[dict[str, Any]] = []
        for group in self.material_recipe_groups:
            recipes = []
            for recipe_id in group.recipe_ids:
                recipe = self.recipes_by_id.get(recipe_id)
                if recipe is None or recipe_id not in self.selectable_recipe_ids:
                    continue
                recipes.append(self._catalog_recipe_to_dict(recipe, group.item_class))
            if not recipes:
                continue
            materials.append(
                {
                    "item": self._item_to_dict(self._item_for_class(group.item_class)),
                    "materialCategory": group.material_category,
                    "recipes": recipes,
                }
            )
        return {
            "materials": materials,
            "defaultEnabledRecipeIds": sorted(self.default_enabled_recipe_ids),
            "selectableRecipeIds": sorted(self.selectable_recipe_ids),
        }

    def plan(
        self,
        targets: Iterable[dict[str, Any]],
        selected_recipes: Any | None = None,
        recipe_mode: Any | None = None,
        baseline_recipe_ids: Any | None = None,
        preferred_plan: Any | None = None,
        enabled_recipe_ids: Any | None = None,
    ) -> dict[str, Any]:
        parsed_targets = self._parse_targets(targets)
        active_recipe_ids = self._parse_enabled_recipe_ids(enabled_recipe_ids)
        try:
            solution = self._solve_linear_plan(parsed_targets, active_recipe_ids, set())
        except PlannerError as exc:
            expansion = self._minimum_recipe_expansion(parsed_targets, active_recipe_ids)
            if expansion and expansion["recipeIds"]:
                return self._recipe_expansion_response(parsed_targets, active_recipe_ids, expansion, str(exc))
            raise

        return {
            "targets": [
                {
                    "item": self._item_to_dict(target["item"]),
                    "rate": target["rate"],
                    "kind": "powerGroup" if target.get("powerGroup") else "item",
                }
                for target in parsed_targets
            ],
            "targetAllocations": solution["targetAllocations"],
            "recipeMode": "custom",
            "selectedRecipes": {},
            "enabledRecipeIds": sorted(active_recipe_ids),
            "roots": solution["layers"],
            "layers": solution["layers"],
            "recipeRuns": solution["recipeRuns"],
            "materialBalances": solution["materialBalances"],
            "rawTotals": solution["rawTotals"],
            "totals": solution["totals"],
            "summary": {
                "targetCount": len(parsed_targets),
                "recipeRunCount": len(solution["recipeRuns"]),
                "totalRows": len(solution["totals"]),
                "objectiveValue": solution["objectiveValue"],
                "secondaryObjectiveValue": solution["secondaryObjectiveValue"],
                "selectedRecipeCount": len(active_recipe_ids),
                "recipeMode": "custom",
                "refined": False,
                "changeObjectiveValue": solution.get("changeObjectiveValue", 0),
            },
            "preferredPlan": self._solution_plan_nodes(solution),
        }

    def _recipe_expansion_response(
        self,
        parsed_targets: list[dict[str, Any]],
        active_recipe_ids: set[str],
        expansion: dict[str, Any],
        failure_message: str,
    ) -> dict[str, Any]:
        recipe_ids = [
            recipe_id
            for recipe_id in expansion.get("recipeIds", [])
            if recipe_id in self.recipes_by_id
        ]
        target_text = self._target_request_text(parsed_targets)
        return {
            "recipeExpansionRequired": True,
            "targets": [
                {
                    "item": self._item_to_dict(target["item"]),
                    "rate": target["rate"],
                    "kind": "powerGroup" if target.get("powerGroup") else "item",
                }
                for target in parsed_targets
            ],
            "enabledRecipeIds": sorted(active_recipe_ids),
            "requiredRecipeIds": recipe_ids,
            "requiredRecipes": [
                self._recipe_expansion_recipe_to_dict(self.recipes_by_id[recipe_id])
                for recipe_id in recipe_ids
            ],
            "message": f"Producing {target_text} requires the following recipes. Calculated with the fewest added recipes.",
            "failure": failure_message,
            "summary": {
                "targetCount": len(parsed_targets),
                "selectedRecipeCount": len(active_recipe_ids),
                "requiredRecipeCount": len(recipe_ids),
                "minimumAdditionalRecipeCount": len(recipe_ids),
                "recipeMode": "custom",
            },
        }

    def _minimum_recipe_expansion(
        self,
        parsed_targets: list[dict[str, Any]],
        active_recipe_ids: set[str],
    ) -> dict[str, Any] | None:
        if milp is None or Bounds is None or LinearConstraint is None:
            return None

        candidate_recipes = tuple(
            recipe for recipe in self.recipes if recipe.recipe_id in self.selectable_recipe_ids
        )
        material_classes = self._plan_material_classes(parsed_targets, candidate_recipes)
        material_index = {item_class: index for index, item_class in enumerate(material_classes)}
        raw_classes = sorted(self.external_source_classes & set(material_classes))
        recipe_count = len(candidate_recipes)
        raw_count = len(raw_classes)
        flow_count = recipe_count + raw_count
        variable_count = flow_count + recipe_count
        big_m = self._milp_big_m(parsed_targets)

        net_matrix = [[0.0 for _ in range(flow_count)] for _ in material_classes]
        demand = [0.0 for _ in material_classes]
        power_group_targets: list[dict[str, Any]] = []

        for target in parsed_targets:
            if target.get("powerGroup"):
                power_group_targets.append(target)
            else:
                demand[material_index[target["item"].class_name]] += float(target["rate"])

        for recipe_index, recipe in enumerate(candidate_recipes):
            for output in recipe.outputs:
                row_index = material_index.get(output.item_class)
                if row_index is not None:
                    net_matrix[row_index][recipe_index] += output.per_min
            for input_item in recipe.inputs:
                row_index = material_index.get(input_item.item_class)
                if row_index is not None:
                    net_matrix[row_index][recipe_index] -= input_item.per_min

        for raw_offset, item_class in enumerate(raw_classes):
            net_matrix[material_index[item_class]][recipe_count + raw_offset] = 1.0

        constraints: list[Any] = []
        for row_index, row in enumerate(net_matrix):
            constraints.append(LinearConstraint([*row, *([0.0] * recipe_count)], demand[row_index], float("inf")))

        for target in power_group_targets:
            group = target["powerGroup"]
            group_row = [0.0 for _ in range(flow_count)]
            for member_class in group.member_classes:
                row_index = material_index.get(member_class)
                if row_index is None:
                    continue
                for variable_index, value in enumerate(net_matrix[row_index]):
                    group_row[variable_index] += value
            if not any(abs(value) > _LP_EPS for value in group_row):
                return None
            constraints.append(LinearConstraint([*group_row, *([0.0] * recipe_count)], float(target["rate"]), float("inf")))

        for recipe_index in range(recipe_count):
            upper_row = [0.0 for _ in range(variable_count)]
            upper_row[recipe_index] = 1.0
            upper_row[flow_count + recipe_index] = -big_m
            constraints.append(LinearConstraint(upper_row, -float("inf"), 0.0))

        new_recipe_costs = [0.0 for _ in range(flow_count)] + [
            0.0 if recipe.recipe_id in active_recipe_ids else 1.0
            for recipe in candidate_recipes
        ]
        integrality = [0 for _ in range(flow_count)] + [1 for _ in range(recipe_count)]
        bounds = Bounds(
            [0.0 for _ in range(variable_count)],
            [big_m for _ in range(flow_count)] + [1.0 for _ in range(recipe_count)],
        )

        first = self._run_strict_milp(
            c=new_recipe_costs,
            integrality=integrality,
            bounds=bounds,
            constraints=constraints,
        )
        if not first.success:
            return None

        minimum_new_count = max(0, round(float(first.fun)))
        new_recipe_constraint = LinearConstraint(new_recipe_costs, -float("inf"), minimum_new_count + 0.5)

        raw_costs = [0.0 for _ in range(recipe_count)] + [
            self._raw_source_weight(item_class)
            for item_class in raw_classes
        ] + [0.0 for _ in range(recipe_count)]
        second = self._run_strict_milp(
            c=raw_costs,
            integrality=integrality,
            bounds=bounds,
            constraints=[*constraints, new_recipe_constraint],
        )
        result = second if second.success else first

        if second.success:
            raw_minimum = float(second.fun)
            raw_tolerance = max(_LP_EPS, abs(raw_minimum) * 1e-7)
            raw_constraint = LinearConstraint(raw_costs, -float("inf"), raw_minimum + raw_tolerance)
            scale_costs = [1.0 for _ in range(recipe_count)] + [0.0 for _ in range(raw_count)] + [0.0 for _ in range(recipe_count)]
            third = self._run_strict_milp(
                c=scale_costs,
                integrality=integrality,
                bounds=bounds,
                constraints=[*constraints, new_recipe_constraint, raw_constraint],
            )
            if third.success:
                result = third

        values = [float(value) for value in result.x[:recipe_count]]
        binary_values = [float(value) for value in result.x[flow_count:]]
        new_recipe_ids = [
            recipe.recipe_id
            for recipe, value, binary_value in zip(candidate_recipes, values, binary_values)
            if recipe.recipe_id not in active_recipe_ids and value > _RESULT_EPS and binary_value > 0.5
        ]
        if not new_recipe_ids:
            return None
        return {"recipeIds": new_recipe_ids}

    def _run_strict_milp(self, **kwargs: Any) -> Any:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Unrecognized options detected.*", category=RuntimeWarning)
            return milp(**kwargs, options=_MILP_STRICT_OPTIONS)

    def _recipe_expansion_recipe_to_dict(self, recipe: Recipe) -> dict[str, Any]:
        payload = self._recipe_to_dict(recipe)
        payload.update(
            {
                "inputs": [self._ingredient_to_option_dict(item) for item in recipe.inputs],
                "outputs": [self._ingredient_to_option_dict(item) for item in recipe.outputs],
            }
        )
        return payload

    def _target_request_text(self, parsed_targets: list[dict[str, Any]]) -> str:
        parts: list[str] = []
        for target in parsed_targets:
            item = target["item"]
            unit = item.unit or "items"
            parts.append(f"{item.name} { _clean_number(float(target['rate'])) } {unit}/min")
        return ", ".join(parts)

    def _parse_enabled_recipe_ids(self, enabled_recipe_ids: Any | None) -> set[str]:
        if enabled_recipe_ids is None:
            return set(self.default_enabled_recipe_ids)
        if not isinstance(enabled_recipe_ids, list):
            raise PlannerError("enabledRecipeIds must be an array of recipe IDs.")
        return {
            recipe_id
            for recipe_id in (str(value or "").strip() for value in enabled_recipe_ids)
            if recipe_id in self.selectable_recipe_ids
        }

    def _parse_recipe_mode(self, recipe_mode: Any | None) -> str:
        mode = str(recipe_mode or _RECIPE_MODE_BASE).strip()
        if mode in {_RECIPE_MODE_BASE, _RECIPE_MODE_BEST_EFFICIENCY}:
            return mode
        raise PlannerError(f"Unknown recipeMode: {mode}")

    def _parse_recipe_selections(self, selected_recipes: Any | None) -> dict[str, str]:
        if selected_recipes is None:
            return {}
        if not isinstance(selected_recipes, dict):
            raise PlannerError("selectedRecipes must be an object keyed by item class.")

        selections: dict[str, str] = {}
        for raw_item_class, raw_recipe_id in selected_recipes.items():
            item_class = str(raw_item_class or "").strip()
            recipe_id = str(raw_recipe_id or "").strip()
            group = self.replacement_groups_by_item.get(item_class)
            if group and recipe_id == _DIRECT_RAW_RECIPE_ID and item_class in self.external_source_classes:
                selections[item_class] = recipe_id
            elif group and recipe_id in group.recipe_ids:
                selections[item_class] = recipe_id
        return selections

    def _parse_baseline_recipe_ids(self, baseline_recipe_ids: Any | None) -> set[str]:
        if baseline_recipe_ids is None:
            return set()
        if not isinstance(baseline_recipe_ids, list):
            raise PlannerError("baselineRecipeIds must be an array of recipe IDs.")
        return {
            recipe_id
            for recipe_id in (str(value or "").strip() for value in baseline_recipe_ids)
            if recipe_id in self.recipes_by_id
        }

    def _parse_preferred_plan(self, preferred_plan: Any | None) -> dict[str, float]:
        if preferred_plan is None:
            return {}
        if not isinstance(preferred_plan, list):
            raise PlannerError("preferredPlan must be an array of plan node IDs or objects.")

        nodes: dict[str, float] = {}
        for entry in preferred_plan:
            if isinstance(entry, dict):
                node_id = str(entry.get("id") or entry.get("nodeId") or "").strip()
                scale = max(0.0, _float(entry.get("scale")))
            else:
                node_id = str(entry or "").strip()
                scale = 0.0
            if not node_id:
                continue
            if node_id.startswith(_RAW_PLAN_NODE_PREFIX):
                item_class = node_id[len(_RAW_PLAN_NODE_PREFIX):].strip()
                if item_class not in self.external_source_classes:
                    continue
                nodes[self._raw_plan_node_id(item_class)] = scale
            elif node_id in self.recipes_by_id and node_id in self.selectable_recipe_ids:
                nodes[node_id] = scale
        return nodes

    def _active_recipe_selection(
        self,
        selected_recipes: dict[str, str],
        recipe_mode: str,
        baseline_recipe_ids: set[str] | None = None,
    ) -> tuple[set[str], dict[str, str]]:
        if baseline_recipe_ids:
            return self._active_recipe_selection_from_baseline(
                selected_recipes,
                recipe_mode,
                baseline_recipe_ids,
            )

        active_recipe_ids: set[str] = set()
        base_selections: dict[str, str] = {}
        for group in self.replacement_groups:
            selected_recipe_id = selected_recipes.get(group.item_class)
            if selected_recipe_id == _DIRECT_RAW_RECIPE_ID and group.item_class in self.external_source_classes:
                base_selections[group.item_class] = selected_recipe_id
                continue
            if selected_recipe_id not in group.recipe_ids:
                selected_recipe_id = ""
            if selected_recipe_id:
                active_recipe_ids.add(selected_recipe_id)
                base_selections[group.item_class] = selected_recipe_id
            elif recipe_mode == _RECIPE_MODE_BEST_EFFICIENCY:
                active_recipe_ids.update(group.recipe_ids)
                base_selections[group.item_class] = group.recipe_ids[0]
            else:
                base_recipe_ids = group.base_recipe_ids
                if not base_recipe_ids:
                    continue
                active_recipe_ids.update(base_recipe_ids)
                base_selections[group.item_class] = base_recipe_ids[0]
        return active_recipe_ids, base_selections

    def _active_recipe_selection_from_baseline(
        self,
        selected_recipes: dict[str, str],
        recipe_mode: str,
        baseline_recipe_ids: set[str],
    ) -> tuple[set[str], dict[str, str]]:
        active_recipe_ids = {
            recipe_id
            for recipe_id in baseline_recipe_ids
            if recipe_id in self.recipes_by_id
        }
        base_selections: dict[str, str] = {}

        for group in self.replacement_groups:
            selected_recipe_id = selected_recipes.get(group.item_class)
            if selected_recipe_id == _DIRECT_RAW_RECIPE_ID and group.item_class in self.external_source_classes:
                active_recipe_ids.difference_update(group.recipe_ids)
                base_selections[group.item_class] = selected_recipe_id
                continue
            if selected_recipe_id in group.recipe_ids:
                active_recipe_ids.difference_update(group.recipe_ids)
                active_recipe_ids.add(selected_recipe_id)
                base_selections[group.item_class] = selected_recipe_id

        self._complete_active_recipe_dependencies(active_recipe_ids, selected_recipes, recipe_mode)
        return active_recipe_ids, base_selections

    def _complete_active_recipe_dependencies(
        self,
        active_recipe_ids: set[str],
        selected_recipes: dict[str, str],
        recipe_mode: str,
    ) -> None:
        while True:
            produced_classes = {
                output.item_class
                for recipe_id in active_recipe_ids
                for output in self.recipes_by_id[recipe_id].outputs
            }
            missing_inputs = {
                input_item.item_class
                for recipe_id in active_recipe_ids
                for input_item in self.recipes_by_id[recipe_id].inputs
                if input_item.item_class not in self.external_source_classes
                and input_item.item_class not in produced_classes
            }
            added = False
            for item_class in sorted(missing_inputs):
                group = self.replacement_groups_by_item.get(item_class)
                if not group:
                    continue
                selected_recipe_id = selected_recipes.get(item_class)
                if selected_recipe_id in group.recipe_ids:
                    recipe_ids = (selected_recipe_id,)
                elif recipe_mode == _RECIPE_MODE_BEST_EFFICIENCY:
                    recipe_ids = group.recipe_ids
                else:
                    recipe_ids = group.base_recipe_ids
                for recipe_id in recipe_ids:
                    if recipe_id in self.recipes_by_id and recipe_id not in active_recipe_ids:
                        active_recipe_ids.add(recipe_id)
                        added = True
            if not added:
                return

    def _disabled_raw_source_classes(self, selected_recipes: dict[str, str]) -> set[str]:
        return {
            item_class
            for item_class, recipe_id in selected_recipes.items()
            if item_class in self.external_source_classes and recipe_id != _DIRECT_RAW_RECIPE_ID
        }

    def _effective_recipe_selection(
        self,
        selected_recipes: dict[str, str],
        base_selections: dict[str, str],
        recipe_runs: list[dict[str, Any]],
        recipe_mode: str,
    ) -> dict[str, str]:
        if recipe_mode != _RECIPE_MODE_BEST_EFFICIENCY:
            return dict(base_selections)

        used_scales = {
            str(run.get("id") or ""): float(run.get("scale") or 0.0)
            for run in recipe_runs
        }
        effective_selections: dict[str, str] = {}
        for group in self.replacement_groups:
            selected_recipe_id = selected_recipes.get(group.item_class)
            if selected_recipe_id == _DIRECT_RAW_RECIPE_ID and group.item_class in self.external_source_classes:
                effective_selections[group.item_class] = selected_recipe_id
                continue
            if selected_recipe_id in group.recipe_ids:
                effective_selections[group.item_class] = selected_recipe_id
                continue

            best_recipe_id = max(
                group.recipe_ids,
                key=lambda recipe_id: (
                    used_scales.get(recipe_id, 0.0),
                    -group.recipe_ids.index(recipe_id),
                ),
            )
            effective_selections[group.item_class] = (
                best_recipe_id
                if used_scales.get(best_recipe_id, 0.0) > _RESULT_EPS
                else (_DIRECT_RAW_RECIPE_ID if group.item_class in self.external_source_classes else group.recipe_ids[0])
            )
        return effective_selections

    def _parse_targets(self, targets: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        parsed: list[dict[str, Any]] = []
        for index, target in enumerate(targets, start=1):
            if not isinstance(target, dict):
                raise PlannerError(f"Target #{index} must be an object.")
            item = self._resolve_item(target.get("itemClass") or target.get("itemName") or target.get("name"))
            power_group = self.power_groups_by_class.get(item.class_name)
            try:
                rate = float(target.get("rate"))
            except (TypeError, ValueError) as exc:
                raise PlannerError(f"Target #{index} has an invalid rate.") from exc
            if rate <= 0:
                raise PlannerError(f"Target #{index} rate must be greater than 0.")
            parsed.append({"item": item, "rate": rate, "powerGroup": power_group})
        if not parsed:
            raise PlannerError("At least one production target is required.")
        return parsed

    def _resolve_item(self, value: Any) -> Item:
        text = str(value or "").strip()
        if not text:
            raise PlannerError("Target item is required.")
        if text in self.items:
            return self.items[text]

        normalized = _normalize(text)
        compacted = _compact(text)
        for item in self.items_list:
            if _normalize(item.name) == normalized or _compact(item.name) == compacted:
                return item
        for group in self.power_groups:
            base_name = group.group_name.removesuffix(" (Any)")
            if _normalize(base_name) == normalized or _compact(base_name) == compacted:
                return self.items[group.group_class]
        raise PlannerError(f"Unknown item: {text}")

    def _solve_linear_plan(
        self,
        parsed_targets: list[dict[str, Any]],
        active_recipe_ids: set[str],
        disabled_raw_source_classes: set[str] | None = None,
    ) -> dict[str, Any]:
        if linprog is None:
            raise PlannerError(
                "scipy is required for linear planning. "
                f"Current Python: {sys.executable}. "
                "Run `py -m pip install -r requirements.txt` in satisfactory_calculator, then restart the server."
            )

        candidate_recipes = tuple(
            recipe for recipe in self.recipes if recipe.recipe_id in active_recipe_ids
        )
        material_classes = self._plan_material_classes(parsed_targets, candidate_recipes)
        disabled_raw_source_classes = disabled_raw_source_classes or set()
        raw_classes = sorted((self.external_source_classes - disabled_raw_source_classes) & set(material_classes))
        raw_index = {item_class: index for index, item_class in enumerate(raw_classes)}
        material_index = {item_class: index for index, item_class in enumerate(material_classes)}

        recipe_count = len(candidate_recipes)
        variable_count = recipe_count + len(raw_classes)
        net_matrix = [[0.0 for _ in range(variable_count)] for _ in material_classes]
        demand = [0.0 for _ in material_classes]

        power_group_targets: list[dict[str, Any]] = []
        for target in parsed_targets:
            if target.get("powerGroup"):
                power_group_targets.append(target)
                continue
            demand[material_index[target["item"].class_name]] += target["rate"]

        for recipe_index, recipe in enumerate(candidate_recipes):
            for output in recipe.outputs:
                row_index = material_index.get(output.item_class)
                if row_index is not None:
                    net_matrix[row_index][recipe_index] += output.per_min
            for input_item in recipe.inputs:
                row_index = material_index.get(input_item.item_class)
                if row_index is not None:
                    net_matrix[row_index][recipe_index] -= input_item.per_min

        for item_class, index in raw_index.items():
            net_matrix[material_index[item_class]][recipe_count + index] = 1.0

        raw_costs = [0.0 for _ in range(recipe_count)] + [
            self._raw_source_weight(item_class)
            for item_class in raw_classes
        ]
        a_ub = [[-value for value in row] for row in net_matrix]
        b_ub = [-value for value in demand]
        for target in power_group_targets:
            group = target["powerGroup"]
            group_row = [0.0 for _ in range(variable_count)]
            for member_class in group.member_classes:
                row_index = material_index.get(member_class)
                if row_index is None:
                    continue
                for variable_index, value in enumerate(net_matrix[row_index]):
                    group_row[variable_index] += value
            if not any(abs(value) > _LP_EPS for value in group_row):
                raise PlannerError(f"Power group has no active member recipes: {group.group_name}")
            a_ub.append([-value for value in group_row])
            b_ub.append(-target["rate"])
        bounds = [(0.0, None) for _ in range(variable_count)]

        first = linprog(raw_costs, A_ub=a_ub, b_ub=b_ub, bounds=bounds, method="highs")
        if not first.success:
            raise PlannerError(f"No feasible production plan found: {first.message}")

        raw_minimum = float(first.fun)
        tolerance = max(_LP_EPS, abs(raw_minimum) * 1e-7)
        second_stage_a_ub = [*a_ub, raw_costs]
        second_stage_b_ub = [*b_ub, raw_minimum + tolerance]
        secondary_costs = [1.0 for _ in range(recipe_count)] + [0.0 for _ in raw_classes]
        second = linprog(
            secondary_costs,
            A_ub=second_stage_a_ub,
            b_ub=second_stage_b_ub,
            bounds=bounds,
            method="highs",
        )
        result = second if second.success else first
        values = [float(value) for value in result.x]

        return self._build_solution_from_values(
            parsed_targets,
            material_classes,
            candidate_recipes,
            raw_classes,
            values[:recipe_count],
            [values[recipe_count + index] for index in range(len(raw_classes))],
            raw_minimum,
            float(result.fun),
        )

    def _build_solution_from_values(
        self,
        parsed_targets: list[dict[str, Any]],
        material_classes: list[str],
        candidate_recipes: tuple[Recipe, ...],
        raw_classes: list[str],
        recipe_values: list[float],
        raw_values: list[float],
        objective_value: float,
        secondary_objective_value: float,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        recipe_runs = self._build_recipe_runs(candidate_recipes, recipe_values)
        raw_supplies = {
            item_class: raw_values[index]
            for index, item_class in enumerate(raw_classes)
            if index < len(raw_values) and raw_values[index] > _RESULT_EPS
        }
        raw_supplies = self._sanitize_raw_supplies(raw_supplies, parsed_targets, recipe_runs)
        target_allocations = self._build_target_allocations(parsed_targets, recipe_runs, raw_supplies)
        material_balances = self._build_material_balances(material_classes, target_allocations, recipe_runs, raw_supplies)
        layers = self._build_plan_layers(target_allocations, recipe_runs, raw_supplies)
        totals = self._build_total_rows(material_balances)
        raw_totals = [
            {
                "item": self._item_to_dict(self._item_for_class(item_class)),
                "rate": _clean_number(rate),
            }
            for item_class, rate in sorted(
                raw_supplies.items(),
                key=lambda entry: (self._item_for_class(entry[0]).name.lower(), entry[0]),
            )
        ]

        solution = {
            "recipeRuns": recipe_runs,
            "targetAllocations": target_allocations,
            "materialBalances": material_balances,
            "rawTotals": raw_totals,
            "layers": layers,
            "totals": totals,
            "objectiveValue": _clean_number(objective_value),
            "secondaryObjectiveValue": _clean_number(secondary_objective_value),
        }
        if extra:
            solution.update(extra)
        return solution

    def _solve_preferred_plan_milp(
        self,
        parsed_targets: list[dict[str, Any]],
        preferred_plan_nodes: dict[str, float],
    ) -> dict[str, Any]:
        if milp is None or Bounds is None or LinearConstraint is None:
            raise PlannerError(
                "scipy with MILP support is required for refined planning. "
                f"Current Python: {sys.executable}. "
                "Run `py -m pip install -r requirements.txt` in satisfactory_calculator, then restart the server."
            )

        candidate_recipes = tuple(
            recipe for recipe in self.recipes if recipe.recipe_id in self.selectable_recipe_ids
        )
        material_classes = self._plan_material_classes(parsed_targets, candidate_recipes)
        material_set = set(material_classes)
        raw_classes = sorted(self.external_source_classes & material_set)
        material_index = {item_class: index for index, item_class in enumerate(material_classes)}
        recipe_count = len(candidate_recipes)
        raw_count = len(raw_classes)
        x_count = recipe_count + raw_count
        variable_count = x_count * 2
        big_m = self._milp_big_m(parsed_targets)

        net_matrix = [[0.0 for _ in range(x_count)] for _ in material_classes]
        demand = [0.0 for _ in material_classes]
        power_group_targets: list[dict[str, Any]] = []

        for target in parsed_targets:
            if target.get("powerGroup"):
                power_group_targets.append(target)
                continue
            demand[material_index[target["item"].class_name]] += target["rate"]

        for recipe_index, recipe in enumerate(candidate_recipes):
            for output in recipe.outputs:
                row_index = material_index.get(output.item_class)
                if row_index is not None:
                    net_matrix[row_index][recipe_index] += output.per_min
            for input_item in recipe.inputs:
                row_index = material_index.get(input_item.item_class)
                if row_index is not None:
                    net_matrix[row_index][recipe_index] -= input_item.per_min

        for raw_offset, item_class in enumerate(raw_classes):
            net_matrix[material_index[item_class]][recipe_count + raw_offset] = 1.0

        constraints: list[Any] = []
        for row_index, row in enumerate(net_matrix):
            constraints.append(LinearConstraint([*row, *([0.0] * x_count)], demand[row_index], float("inf")))

        for target in power_group_targets:
            group = target["powerGroup"]
            group_row = [0.0 for _ in range(x_count)]
            for member_class in group.member_classes:
                row_index = material_index.get(member_class)
                if row_index is None:
                    continue
                for variable_index, value in enumerate(net_matrix[row_index]):
                    group_row[variable_index] += value
            if not any(abs(value) > _LP_EPS for value in group_row):
                raise PlannerError(f"Power group has no active member recipes: {group.group_name}")
            constraints.append(LinearConstraint([*group_row, *([0.0] * x_count)], target["rate"], float("inf")))

        node_ids = [
            *[recipe.recipe_id for recipe in candidate_recipes],
            *[self._raw_plan_node_id(item_class) for item_class in raw_classes],
        ]
        for index, node_id in enumerate(node_ids):
            upper_row = [0.0 for _ in range(variable_count)]
            upper_row[index] = 1.0
            upper_row[x_count + index] = -big_m
            constraints.append(LinearConstraint(upper_row, -float("inf"), 0.0))

            lower_row = [0.0 for _ in range(variable_count)]
            lower_row[index] = 1.0
            lower_row[x_count + index] = -self._milp_min_use(node_id, preferred_plan_nodes)
            constraints.append(LinearConstraint(lower_row, 0.0, float("inf")))

        change_costs = [0.0 for _ in range(x_count)] + [
            -1.0 if node_id in preferred_plan_nodes else 1.0
            for node_id in node_ids
        ]
        integrality = [0 for _ in range(x_count)] + [1 for _ in range(x_count)]
        bounds = Bounds([0.0 for _ in range(variable_count)], [big_m for _ in range(x_count)] + [1.0 for _ in range(x_count)])

        first = milp(c=change_costs, integrality=integrality, bounds=bounds, constraints=constraints)
        if not first.success:
            raise PlannerError(f"No feasible refined production plan found: {first.message}")

        change_minimum = float(first.fun)
        change_tolerance = max(_LP_EPS, abs(change_minimum) * 1e-7)
        change_constraint = LinearConstraint(change_costs, -float("inf"), change_minimum + change_tolerance)

        raw_costs = [0.0 for _ in range(recipe_count)] + [
            self._raw_source_weight(item_class)
            for item_class in raw_classes
        ] + [0.0 for _ in range(x_count)]
        second_constraints = [*constraints, change_constraint]
        second = milp(c=raw_costs, integrality=integrality, bounds=bounds, constraints=second_constraints)
        if not second.success:
            result = first
            raw_minimum = 0.0
            scale_objective = 0.0
        else:
            raw_minimum = float(second.fun)
            raw_tolerance = max(_LP_EPS, abs(raw_minimum) * 1e-7)
            raw_constraint = LinearConstraint(raw_costs, -float("inf"), raw_minimum + raw_tolerance)
            scale_costs = [1.0 for _ in range(recipe_count)] + [0.0 for _ in range(raw_count)] + [0.0 for _ in range(x_count)]
            third = milp(
                c=scale_costs,
                integrality=integrality,
                bounds=bounds,
                constraints=[*second_constraints, raw_constraint],
            )
            result = third if third.success else second
            scale_objective = float(result.fun) if third.success else 0.0

        values = [float(value) for value in result.x[:x_count]]
        used_node_ids = {
            node_id
            for node_id, value in zip(node_ids, values)
            if value > _RESULT_EPS
        }
        preferred_node_ids = set(preferred_plan_nodes)
        change_count = len(used_node_ids - preferred_node_ids) + len(preferred_node_ids - used_node_ids)
        return self._build_solution_from_values(
            parsed_targets,
            material_classes,
            candidate_recipes,
            raw_classes,
            values[:recipe_count],
            values[recipe_count:],
            raw_minimum,
            scale_objective,
            {
                "changeObjectiveValue": change_count,
                "preferredPlan": [
                    {"id": node_id, "scale": _clean_number(scale)}
                    for node_id, scale in preferred_plan_nodes.items()
                ],
            },
        )

    def _milp_big_m(self, parsed_targets: list[dict[str, Any]]) -> float:
        total_rate = sum(abs(float(target.get("rate") or 0.0)) for target in parsed_targets)
        return max(10_000.0, total_rate * 10_000.0)

    def _milp_min_use(self, node_id: str, preferred_plan_nodes: dict[str, float]) -> float:
        preferred_scale = preferred_plan_nodes.get(node_id, 0.0)
        if preferred_scale > _RESULT_EPS:
            return max(_RESULT_EPS, preferred_scale * _PREFERRED_KEEP_MIN_RATIO)
        return _RESULT_EPS

    def _raw_plan_node_id(self, item_class: str) -> str:
        return f"{_RAW_PLAN_NODE_PREFIX}{item_class}"

    def _solution_plan_nodes(self, solution: dict[str, Any]) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        for run in solution.get("recipeRuns", []):
            recipe_id = str(run.get("id") or "").strip()
            if recipe_id:
                nodes.append({"id": recipe_id, "scale": run.get("scale", 0.0)})
        for raw in solution.get("rawTotals", []):
            item_class = str(raw.get("item", {}).get("className") or "").strip()
            if item_class:
                nodes.append({"id": self._raw_plan_node_id(item_class), "scale": raw.get("rate", 0.0)})
        return nodes

    def _plan_material_classes(
        self,
        parsed_targets: list[dict[str, Any]],
        recipes: tuple[Recipe, ...],
    ) -> list[str]:
        classes = {
            item_class
            for recipe in recipes
            for ingredient in (*recipe.inputs, *recipe.outputs)
            for item_class in [ingredient.item_class]
        }
        for target in parsed_targets:
            group = target.get("powerGroup")
            if group:
                classes.update(group.member_classes)
            else:
                classes.add(target["item"].class_name)
        return sorted(classes)

    def _build_recipe_runs(self, recipes: tuple[Recipe, ...], recipe_scales: list[float]) -> list[dict[str, Any]]:
        runs: list[dict[str, Any]] = []
        for recipe, scale in zip(recipes, recipe_scales):
            if scale <= _RESULT_EPS:
                continue
            runs.append(
                {
                    "id": recipe.recipe_id,
                    "recipe": self._recipe_to_dict(recipe),
                    "scale": _clean_number(scale),
                    "inputs": [
                        self._scaled_ingredient_to_dict(input_item, scale, "input")
                        for input_item in recipe.inputs
                    ],
                    "outputs": [
                        self._scaled_ingredient_to_dict(output, scale, "output", index, len(recipe.outputs))
                        for index, output in enumerate(recipe.outputs)
                    ],
                }
            )
        runs.sort(key=lambda run: (run["recipe"]["name"].lower(), run["recipe"]["id"]))
        return runs

    def _build_target_allocations(
        self,
        parsed_targets: list[dict[str, Any]],
        recipe_runs: list[dict[str, Any]],
        raw_supplies: dict[str, float],
    ) -> list[dict[str, Any]]:
        available: dict[str, float] = defaultdict(float)
        for item_class, rate in raw_supplies.items():
            available[item_class] += float(rate)
        for run in recipe_runs:
            for output in run["outputs"]:
                available[output["item"]["className"]] += float(output["rate"])
            for input_item in run["inputs"]:
                available[input_item["item"]["className"]] -= float(input_item["rate"])

        allocations: list[dict[str, Any]] = []
        for target in parsed_targets:
            if target.get("powerGroup"):
                continue
            item = target["item"]
            rate = float(target["rate"])
            available[item.class_name] -= rate
            allocations.append(
                {
                    "targetItem": self._item_to_dict(item),
                    "item": self._item_to_dict(item),
                    "rate": _clean_number(rate),
                    "kind": "direct",
                }
            )

        for target in parsed_targets:
            group = target.get("powerGroup")
            if not group:
                continue
            remaining = float(target["rate"])
            allocation_start_index = len(allocations)
            tolerance = max(_RESULT_EPS, abs(remaining) * 1e-6)
            members = sorted(
                group.member_classes,
                key=lambda item_class: (
                    -max(0.0, available.get(item_class, 0.0)),
                    group.member_classes.index(item_class),
                    self._item_for_class(item_class).name.lower(),
                ),
            )
            for member_class in members:
                if remaining <= _RESULT_EPS:
                    break
                member_available = max(0.0, available.get(member_class, 0.0))
                used = min(remaining, member_available)
                if used <= _RESULT_EPS:
                    continue
                available[member_class] -= used
                remaining -= used
                allocations.append(
                    {
                        "targetItem": self._item_to_dict(target["item"]),
                        "item": self._item_to_dict(self._item_for_class(member_class)),
                        "rate": _clean_number(used),
                        "kind": "powerGroup",
                    }
                )

            if 0 < remaining <= tolerance and len(allocations) > allocation_start_index:
                allocations[-1]["rate"] = _clean_number(float(allocations[-1]["rate"]) + remaining)
                remaining = 0.0

            if remaining > tolerance and members:
                member_class = members[0]
                available[member_class] -= remaining
                allocations.append(
                    {
                        "targetItem": self._item_to_dict(target["item"]),
                        "item": self._item_to_dict(self._item_for_class(member_class)),
                        "rate": _clean_number(remaining),
                        "kind": "powerGroup",
                    }
                )
        return allocations

    def _sanitize_raw_supplies(
        self,
        raw_supplies: dict[str, float],
        parsed_targets: list[dict[str, Any]],
        recipe_runs: list[dict[str, Any]],
    ) -> dict[str, float]:
        if not raw_supplies:
            return {}

        consumed_classes = {
            input_item["item"]["className"]
            for run in recipe_runs
            for input_item in run["inputs"]
            if float(input_item.get("rate") or 0.0) > _RESULT_EPS
        }
        material_scales: dict[str, float] = defaultdict(float)
        for run in recipe_runs:
            for output in run["outputs"]:
                item_class = output["item"]["className"]
                material_scales[item_class] = max(material_scales[item_class], abs(float(output.get("rate") or 0.0)))
            for input_item in run["inputs"]:
                item_class = input_item["item"]["className"]
                material_scales[item_class] = max(material_scales[item_class], abs(float(input_item.get("rate") or 0.0)))
        target_classes = {
            target["item"].class_name
            for target in parsed_targets
            if not target.get("powerGroup")
        }
        for target in parsed_targets:
            if not target.get("powerGroup"):
                material_scales[target["item"].class_name] = max(
                    material_scales[target["item"].class_name],
                    abs(float(target["rate"])),
                )

        cleaned: dict[str, float] = {}
        for item_class, rate in raw_supplies.items():
            if item_class not in consumed_classes and item_class not in target_classes:
                continue
            if rate > _display_noise_floor(material_scales.get(item_class, rate)):
                cleaned[item_class] = rate
        return cleaned

    def _build_material_balances(
        self,
        material_classes: list[str],
        target_allocations: list[dict[str, Any]],
        recipe_runs: list[dict[str, Any]],
        raw_supplies: dict[str, float],
    ) -> list[dict[str, Any]]:
        balances: dict[str, dict[str, Any]] = {}
        for item_class in material_classes:
            item = self._item_for_class(item_class)
            balances[item_class] = {
                "item": self._item_to_dict(item),
                "produced": 0.0,
                "consumed": 0.0,
                "external": raw_supplies.get(item_class, 0.0),
                "targetDemand": 0.0,
                "surplus": 0.0,
                "raw": self._is_terminal_raw(item),
                "producers": set(),
                "consumers": set(),
            }

        for allocation in target_allocations:
            item_class = allocation["item"]["className"]
            if item_class in balances:
                balances[item_class]["targetDemand"] += float(allocation["rate"])

        for run in recipe_runs:
            recipe_name = run["recipe"]["name"]
            for output in run["outputs"]:
                balance = balances[output["item"]["className"]]
                balance["produced"] += float(output["rate"])
                balance["producers"].add(recipe_name)
            for input_item in run["inputs"]:
                balance = balances[input_item["item"]["className"]]
                balance["consumed"] += float(input_item["rate"])
                balance["consumers"].add(recipe_name)

        result: list[dict[str, Any]] = []
        for balance in balances.values():
            balance["surplus"] = (
                balance["produced"]
                + balance["external"]
                - balance["consumed"]
                - balance["targetDemand"]
            )
            balance_scale = max(
                abs(balance["produced"]),
                abs(balance["consumed"]),
                abs(balance["external"]),
                abs(balance["targetDemand"]),
            )
            if abs(balance["surplus"]) <= _display_noise_floor(balance_scale):
                balance["surplus"] = 0.0
            produced = _clean_number(balance["produced"])
            consumed = _clean_number(balance["consumed"])
            external = _clean_number(balance["external"])
            target_demand = _clean_number(balance["targetDemand"])
            surplus = _clean_number(balance["surplus"])
            if not any(abs(float(value)) > _RESULT_EPS for value in [produced, consumed, external, target_demand, surplus]):
                continue
            result.append(
                {
                    "item": balance["item"],
                    "produced": produced,
                    "consumed": consumed,
                    "external": external,
                    "targetDemand": target_demand,
                    "surplus": surplus,
                    "raw": balance["raw"],
                    "producers": sorted(balance["producers"]),
                    "consumers": sorted(balance["consumers"]),
                }
            )

        result.sort(key=lambda row: (row["raw"], row["item"]["name"].lower(), row["item"]["className"]))
        return result

    def _build_plan_layers(
        self,
        target_allocations: list[dict[str, Any]],
        recipe_runs: list[dict[str, Any]],
        raw_supplies: dict[str, float],
    ) -> list[dict[str, Any]]:
        layers: list[dict[str, Any]] = []
        remaining = {run["id"]: run for run in recipe_runs}
        demanded = {allocation["item"]["className"] for allocation in target_allocations}
        layer_index = 0

        while remaining and demanded:
            selected_ids = [
                run_id
                for run_id, run in remaining.items()
                if any(output["item"]["className"] in demanded for output in run["outputs"])
            ]
            if not selected_ids:
                break

            selected = [remaining.pop(run_id) for run_id in selected_ids]
            selected.sort(key=lambda run: (run["recipe"]["name"].lower(), run["recipe"]["id"]))
            layers.append(
                {
                    "title": "Target Outputs" if layer_index == 0 else f"Supply Layer {layer_index}",
                    "kind": "recipes",
                    "recipeRuns": selected,
                }
            )
            demanded = {
                input_item["item"]["className"]
                for run in selected
                for input_item in run["inputs"]
                if input_item["item"]["className"] not in self.external_source_classes
            }
            layer_index += 1

        if remaining:
            shared_runs = sorted(
                remaining.values(),
                key=lambda run: (run["recipe"]["name"].lower(), run["recipe"]["id"]),
            )
            layers.append(
                {
                    "title": "Shared / Loop Supply",
                    "kind": "recipes",
                    "recipeRuns": shared_runs,
                }
            )

        if raw_supplies:
            layers.append(
                {
                    "title": "External Input",
                    "kind": "raw",
                    "rawItems": [
                        {
                            "item": self._item_to_dict(self._item_for_class(item_class)),
                            "rate": _clean_number(rate),
                        }
                        for item_class, rate in sorted(
                            raw_supplies.items(),
                            key=lambda entry: (self._item_for_class(entry[0]).name.lower(), entry[0]),
                        )
                    ],
                }
            )

        return layers

    def _build_total_rows(self, material_balances: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for balance in material_balances:
            demand_rate = float(balance["consumed"]) + float(balance["targetDemand"])
            if demand_rate <= _RESULT_EPS:
                continue
            rows.append(
                {
                    "item": balance["item"],
                    "rate": _clean_number(demand_rate),
                    "raw": balance["raw"],
                    "recipes": balance["producers"],
                }
            )
        rows.sort(key=lambda row: (row["raw"], row["item"]["name"].lower(), row["item"]["className"]))
        return rows

    def _scaled_ingredient_to_dict(
        self,
        ingredient: Ingredient,
        scale: float,
        direction: str,
        output_index: int = 0,
        output_count: int = 1,
    ) -> dict[str, Any]:
        role = direction
        if direction == "output":
            role = "byproduct" if output_count > 1 and output_index > 0 else "output"
        return {
            "item": self._item_to_dict(self._item_for_class(ingredient.item_class)),
            "rate": _clean_number(ingredient.per_min * scale),
            "unit": ingredient.unit,
            "role": role,
        }

    def _raw_source_weight(self, item_class: str) -> float:
        if item_class in self.pickup_source_classes:
            return 1_000_000.0
        return 1.0

    def _is_terminal_raw(self, item: Item) -> bool:
        return item.class_name in self.external_source_classes

    def _attach_raw_recipe_switch_options(
        self,
        solution: dict[str, Any],
        effective_selections: dict[str, str],
    ) -> None:
        for raw_total in solution.get("rawTotals", []):
            self._annotate_raw_recipe_switch(raw_total, effective_selections, force_direct=True)
        for layer in solution.get("layers", []):
            if layer.get("kind") != "raw":
                continue
            for raw_item in layer.get("rawItems", []):
                self._annotate_raw_recipe_switch(raw_item, effective_selections, force_direct=True)
        for total in solution.get("totals", []):
            if total.get("raw"):
                self._annotate_raw_recipe_switch(total, effective_selections)

    def _annotate_raw_recipe_switch(
        self,
        raw_entry: dict[str, Any],
        effective_selections: dict[str, str],
        force_direct: bool = False,
    ) -> None:
        item_class = str(raw_entry.get("item", {}).get("className") or "").strip()
        if not item_class:
            return
        options = self._raw_replacement_options(item_class)
        if not options:
            return
        raw_entry["selectedRecipeId"] = _DIRECT_RAW_RECIPE_ID if force_direct else effective_selections.get(item_class) or _DIRECT_RAW_RECIPE_ID
        raw_entry["defaultRecipeId"] = _DIRECT_RAW_RECIPE_ID
        raw_entry["replacementOptions"] = options

    def _raw_replacement_options(self, item_class: str) -> list[dict[str, Any]]:
        if item_class not in self.external_source_classes:
            return []
        group = self.replacement_groups_by_item.get(item_class)
        if not group or not group.recipe_ids:
            return []
        return [
            self._direct_raw_option_to_dict(item_class),
            *[
                self._recipe_option_to_dict(self.recipes_by_id[recipe_id])
                for recipe_id in group.recipe_ids
                if recipe_id in self.recipes_by_id
            ],
        ]

    def _direct_raw_option_to_dict(self, item_class: str) -> dict[str, Any]:
        item = self._item_for_class(item_class)
        return {
            "id": _DIRECT_RAW_RECIPE_ID,
            "name": "Use Material Directly",
            "isDirectRaw": True,
            "inputs": [],
            "outputs": [
                {
                    "item": self._item_to_dict(item),
                    "rate": 1,
                    "unit": item.unit,
                }
            ],
        }

    def _item_for_class(self, item_class: str) -> Item:
        return self.items.get(
            item_class,
            Item(
                class_name=item_class,
                name=item_class,
                unit="items",
                form="",
                material_category="",
                is_raw_resource=False,
                producible=False,
                icon_path="",
            ),
        )

    def _item_to_dict(self, item: Item) -> dict[str, Any]:
        return {
            "className": item.class_name,
            "name": item.name,
            "unit": item.unit,
            "form": item.form,
            "materialCategory": item.material_category,
            "isRawResource": item.is_raw_resource,
            "producible": item.producible,
            "iconPath": _static_data_path(item.icon_path) if item.icon_path else "",
        }

    def _recipe_to_dict(self, recipe: Recipe) -> dict[str, Any]:
        primary_output = recipe.outputs[0] if recipe.outputs else None
        primary_item_class = primary_output.item_class if primary_output else ""
        device_icons = self._device_icons_for_recipe(recipe)
        return {
            "id": recipe.recipe_id,
            "name": recipe.name,
            "isAlternate": recipe.is_alternate,
            "flags": list(recipe.flags),
            "producedIn": list(recipe.produced_in),
            "producedInClasses": list(recipe.produced_in_classes),
            "deviceIcons": device_icons,
            "deviceIconPath": device_icons[0]["iconPath"] if device_icons else "",
            "durationSec": _clean_number(recipe.duration_sec),
            "primaryOutput": self._item_to_dict(self._item_for_class(primary_item_class)) if primary_item_class else None,
            "replacementOptions": [],
        }

    def _device_icons_for_recipe(self, recipe: Recipe) -> list[dict[str, str]]:
        icons: list[dict[str, str]] = []
        for device_class in recipe.produced_in_classes:
            device = self.devices.get(device_class)
            if device is None or not device.icon_path:
                continue
            icons.append(
                {
                    "className": device.class_name,
                    "name": device.name,
                    "iconPath": _static_data_path(device.icon_path),
                }
            )
        return icons

    def _catalog_recipe_to_dict(self, recipe: Recipe, material_class: str) -> dict[str, Any]:
        payload = self._recipe_to_dict(recipe)
        payload.update(
            {
                "relation": "primary" if recipe.outputs and recipe.outputs[0].item_class == material_class else "byproduct",
                "inputs": [self._ingredient_to_option_dict(item) for item in recipe.inputs],
                "outputs": [self._ingredient_to_option_dict(item) for item in recipe.outputs],
                "defaultEnabled": recipe.recipe_id in self.default_enabled_recipe_ids,
            }
        )
        return payload

    def _replacement_options_for_recipe_group(
        self,
        group: ReplacementGroup | None,
        recipe: Recipe,
    ) -> list[dict[str, Any]]:
        if group is None:
            return [self._recipe_option_to_dict(recipe)]
        options: list[dict[str, Any]] = []
        if group.item_class in self.external_source_classes:
            options.append(self._direct_raw_option_to_dict(group.item_class))
        options.extend(
            self._recipe_option_to_dict(self.recipes_by_id[recipe_id])
            for recipe_id in group.recipe_ids
            if recipe_id in self.recipes_by_id
        )
        return options

    def _recipe_option_to_dict(self, recipe: Recipe) -> dict[str, Any]:
        return {
            "id": recipe.recipe_id,
            "name": recipe.name,
            "isAlternate": recipe.is_alternate,
            "flags": list(recipe.flags),
            "inputs": [self._ingredient_to_option_dict(item) for item in recipe.inputs],
            "outputs": [self._ingredient_to_option_dict(item) for item in recipe.outputs],
        }

    def _ingredient_to_option_dict(self, ingredient: Ingredient) -> dict[str, Any]:
        return {
            "item": self._item_to_dict(self._item_for_class(ingredient.item_class)),
            "rate": _clean_number(ingredient.per_min),
            "unit": ingredient.unit,
        }

    def _build_recipes_by_output(self, recipes: tuple[Recipe, ...]) -> dict[str, list[RecipeChoice]]:
        recipes_by_output: dict[str, list[RecipeChoice]] = defaultdict(list)
        for recipe in recipes:
            for output in recipe.outputs:
                recipes_by_output[output.item_class].append(RecipeChoice(recipe, output))

        for choices in recipes_by_output.values():
            choices.sort(key=lambda choice: (_recipe_score(choice), choice.recipe.name.lower(), choice.recipe.recipe_id))
        return dict(recipes_by_output)


def _load_xlsx_sheets(path: Path) -> dict[str, list[list[Any]]]:
    if not path.exists():
        raise PlannerError(f"Excel workbook not found: {path}")

    with zipfile.ZipFile(path) as workbook:
        shared_strings = _read_shared_strings(workbook)
        workbook_root = ET.fromstring(workbook.read("xl/workbook.xml"))
        rels_root = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {
            rel.attrib.get("Id"): rel.attrib.get("Target", "")
            for rel in rels_root.findall(f"{_PACKAGE_REL_NS}Relationship")
        }

        sheets: dict[str, list[list[Any]]] = {}
        for sheet in workbook_root.findall(f"{_MAIN_NS}sheets/{_MAIN_NS}sheet"):
            sheet_name = str(sheet.attrib.get("name", "")).strip()
            rel_id = sheet.attrib.get(f"{_REL_NS}id")
            target = rel_targets.get(rel_id)
            if not sheet_name or not target:
                continue
            sheet_path = _target_to_zip_path(target)
            sheets[sheet_name] = _read_worksheet(workbook, sheet_path, shared_strings)
        return sheets


def _read_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for item in root.findall(f"{_MAIN_NS}si"):
        values.append("".join(text.text or "" for text in item.iter(f"{_MAIN_NS}t")))
    return values


def _target_to_zip_path(target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return (PurePosixPath("xl") / target).as_posix()


def _read_worksheet(workbook: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[Any]]:
    root = ET.fromstring(workbook.read(sheet_path))
    rows: list[list[Any]] = []
    for row in root.findall(f"{_MAIN_NS}sheetData/{_MAIN_NS}row"):
        values: list[Any] = []
        for cell in row.findall(f"{_MAIN_NS}c"):
            cell_ref = cell.attrib.get("r", "")
            col_index = _column_index(cell_ref)
            while len(values) < col_index - 1:
                values.append("")
            values.append(_cell_value(cell, shared_strings))
        rows.append(values)
    _apply_merged_cell_values(rows, root)
    return rows


def _apply_merged_cell_values(rows: list[list[Any]], root: ET.Element) -> None:
    for merge_cell in root.findall(f"{_MAIN_NS}mergeCells/{_MAIN_NS}mergeCell"):
        bounds = _merge_bounds(merge_cell.attrib.get("ref", ""))
        if not bounds:
            continue
        start_row, start_col, end_row, end_col = bounds
        if start_row < 1 or start_col < 1 or end_row < start_row or end_col < start_col:
            continue
        while len(rows) < end_row:
            rows.append([])
        top_row = rows[start_row - 1]
        while len(top_row) < start_col:
            top_row.append("")
        top_value = top_row[start_col - 1]
        for row_index in range(start_row, end_row + 1):
            row = rows[row_index - 1]
            while len(row) < end_col:
                row.append("")
            for col_index in range(start_col, end_col + 1):
                if row[col_index - 1] == "":
                    row[col_index - 1] = top_value


def _merge_bounds(ref: str) -> tuple[int, int, int, int] | None:
    parts = ref.split(":")
    if len(parts) != 2:
        return None
    start = _cell_coordinates(parts[0])
    end = _cell_coordinates(parts[1])
    if start is None or end is None:
        return None
    return start[0], start[1], end[0], end[1]


def _cell_coordinates(cell_ref: str) -> tuple[int, int] | None:
    match = _CELL_REF_RE.fullmatch(cell_ref)
    if not match:
        return None
    return int(match.group(2)), _column_index(match.group(1))


def _column_index(cell_ref: str) -> int:
    match = _COLUMN_RE.match(cell_ref)
    if not match:
        return 1
    index = 0
    for char in match.group(0):
        index = index * 26 + ord(char) - ord("A") + 1
    return index


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in cell.iter(f"{_MAIN_NS}t"))

    value_node = cell.find(f"{_MAIN_NS}v")
    if value_node is None or value_node.text is None:
        return ""
    raw = value_node.text

    if cell_type == "b":
        return raw == "1"
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return ""
    if cell_type in {"str", "e"}:
        return raw
    return _parse_number(raw)


def _parse_number(raw: str) -> Any:
    try:
        if "." in raw or "e" in raw.lower():
            return float(raw)
        return int(raw)
    except ValueError:
        return raw


def _dict_rows(rows: list[list[Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    headers = [str(value).strip() for value in rows[0]]
    result: list[dict[str, Any]] = []
    for row in rows[1:]:
        if not any(str(value).strip() for value in row):
            continue
        entry = {header: row[index] if index < len(row) else "" for index, header in enumerate(headers) if header}
        result.append(entry)
    return result


def _load_material_infos(rows: list[list[Any]]) -> dict[str, _ItemInfo]:
    infos: dict[str, _ItemInfo] = {}
    for row in _dict_rows(rows):
        class_name = _text(row.get("MaterialClassName") or row.get("ClassName"))
        if not class_name:
            continue
        material_category = _text(row.get("MaterialCategory"))
        infos[class_name] = _ItemInfo(
            class_name=class_name,
            display_name=_text(row.get("MaterialName") or row.get("DisplayName")) or class_name,
            form="RF_POWER" if material_category == _MATERIAL_CATEGORY_POWER else _text(row.get("Form")),
            unit=_text(row.get("Unit")) or "items",
            native_class=_text(row.get("NativeClass")),
            material_category=material_category,
            icon_path=_text(row.get("Icon") or row.get("IconPath")),
        )
    return infos


def _load_devices(rows: list[list[Any]]) -> dict[str, _DeviceInfo]:
    devices: dict[str, _DeviceInfo] = {}
    for row in _dict_rows(rows):
        class_name = _text(row.get("DeviceClassName"))
        if not class_name:
            continue
        devices[class_name] = _DeviceInfo(
            class_name=class_name,
            name=_text(row.get("DeviceName")) or class_name,
            icon_path=_text(row.get("IconPath")),
        )
    return devices


def _load_recipe_io(rows: list[list[Any]]) -> tuple[dict[str, list[Ingredient]], dict[str, str]]:
    by_recipe: dict[str, list[Ingredient]] = defaultdict(list)
    item_names: dict[str, str] = {}
    for row in _dict_rows(rows):
        recipe_id = _text(row.get("RecipeID"))
        item_class = _text(row.get("ItemClass"))
        if not recipe_id or not item_class:
            continue
        item_name = _text(row.get("ItemName")) or item_class
        ingredient = Ingredient(
            item_class=item_class,
            item_name=item_name,
            amount=_float(row.get("Amount")),
            unit=_text(row.get("Unit")) or "items",
            per_min=_float(row.get("AmountPerMin")),
        )
        by_recipe[recipe_id].append(ingredient)
        item_names[item_class] = item_name
    return dict(by_recipe), item_names


def _build_item_names(
    item_infos: dict[str, _ItemInfo],
    input_item_names: dict[str, str],
    output_item_names: dict[str, str],
) -> dict[str, str]:
    item_names = {
        class_name: info.display_name
        for class_name, info in item_infos.items()
        if not _is_building_item_info(info)
    }
    item_names.update(input_item_names)
    item_names.update(output_item_names)
    return item_names


def _planner_item_classes(
    item_infos: dict[str, _ItemInfo],
    input_item_names: dict[str, str],
    output_item_names: dict[str, str],
) -> set[str]:
    classes = {
        class_name
        for class_name, info in item_infos.items()
        if not _is_building_item_info(info)
    }
    classes.update(input_item_names)
    classes.update(output_item_names)
    return {
        class_name
        for class_name in classes
        if not _is_building_item_info(item_infos.get(class_name))
    }


def _derive_material_categories(
    used_classes: set[str],
    item_infos: dict[str, _ItemInfo],
    output_classes: set[str],
) -> dict[str, str]:
    categories: dict[str, str] = {}
    for class_name in used_classes:
        info = item_infos.get(class_name)
        if info is not None and info.material_category:
            categories[class_name] = info.material_category
        elif _is_power_item_info(info):
            categories[class_name] = _MATERIAL_CATEGORY_POWER
        elif _is_raw_resource_item_info(info):
            categories[class_name] = _MATERIAL_CATEGORY_RAW
        elif class_name not in output_classes:
            categories[class_name] = _MATERIAL_CATEGORY_PICKUP
        else:
            categories[class_name] = _MATERIAL_CATEGORY_NORMAL
    return categories


def _source_classes_from_categories(material_categories: dict[str, str]) -> tuple[set[str], set[str]]:
    raw_classes = {
        item_class
        for item_class, category in material_categories.items()
        if category == _MATERIAL_CATEGORY_RAW
    }
    pickup_classes = {
        item_class
        for item_class, category in material_categories.items()
        if category == _MATERIAL_CATEGORY_PICKUP
    }
    if not raw_classes:
        raise PlannerError("Planner data must contain at least one RawMaterial item.")
    return raw_classes, pickup_classes


def _is_building_item_info(info: _ItemInfo | None) -> bool:
    return bool(info and "FGBuildingDescriptor" in info.native_class)


def _is_raw_resource_item_info(info: _ItemInfo | None) -> bool:
    return bool(info and (info.material_category == _MATERIAL_CATEGORY_RAW or "FGResourceDescriptor" in info.native_class))


def _is_power_item_info(info: _ItemInfo | None) -> bool:
    return bool(info and (info.material_category == _MATERIAL_CATEGORY_POWER or info.form == "RF_POWER" or "SyntheticPower" in info.native_class))


def _build_material_recipe_groups(
    recipes: tuple[Recipe, ...],
    item_names: dict[str, str],
    material_categories: dict[str, str],
) -> tuple[MaterialRecipeGroup, ...]:
    recipes_by_id = {recipe.recipe_id: recipe for recipe in recipes}
    recipe_ids_by_material: dict[str, list[str]] = defaultdict(list)

    for recipe in recipes:
        if _recipe_has_flag(recipe, _RECIPE_FLAG_UNPACKAGE):
            continue
        seen_outputs: set[str] = set()
        for output in recipe.outputs:
            item_class = output.item_class
            if item_class in seen_outputs or item_class not in material_categories:
                continue
            recipe_ids = recipe_ids_by_material[item_class]
            if recipe.recipe_id not in recipe_ids:
                recipe_ids.append(recipe.recipe_id)
            seen_outputs.add(item_class)

    result: list[MaterialRecipeGroup] = []
    for item_class, recipe_ids in recipe_ids_by_material.items():
        recipe_ids.sort(key=lambda recipe_id: _material_group_recipe_sort_key(recipes_by_id[recipe_id], item_class))
        result.append(
            MaterialRecipeGroup(
                item_class=item_class,
                item_name=item_names.get(item_class) or item_class,
                material_category=material_categories.get(item_class, ""),
                recipe_ids=tuple(recipe_ids),
            )
        )
    result.sort(key=lambda group: (group.item_name.lower(), group.item_class))
    return tuple(result)


def _build_replacement_groups(
    recipes: tuple[Recipe, ...],
    item_names: dict[str, str],
    material_categories: dict[str, str],
) -> tuple[ReplacementGroup, ...]:
    recipe_ids_by_material: dict[str, list[str]] = defaultdict(list)
    base_recipe_ids_by_material: dict[str, list[str]] = defaultdict(list)

    for recipe in recipes:
        if not recipe.outputs or _recipe_has_flag(recipe, _RECIPE_FLAG_UNPACKAGE):
            continue
        item_class = recipe.outputs[0].item_class
        if item_class not in material_categories:
            continue
        recipe_ids = recipe_ids_by_material[item_class]
        if recipe.recipe_id not in recipe_ids:
            recipe_ids.append(recipe.recipe_id)
        if not recipe.is_alternate and not _recipe_has_flag(recipe, _RECIPE_FLAG_RAW_MATERIAL):
            base_recipe_ids = base_recipe_ids_by_material[item_class]
            if recipe.recipe_id not in base_recipe_ids:
                base_recipe_ids.append(recipe.recipe_id)

    recipes_by_id = {recipe.recipe_id: recipe for recipe in recipes}
    result: list[ReplacementGroup] = []
    for item_class, recipe_ids in recipe_ids_by_material.items():
        recipe_ids.sort(key=lambda recipe_id: _replacement_group_recipe_sort_key(recipes_by_id[recipe_id]))
        base_recipe_ids = base_recipe_ids_by_material.get(item_class, [])
        base_recipe_ids.sort(key=lambda recipe_id: _replacement_group_recipe_sort_key(recipes_by_id[recipe_id]))
        result.append(
            ReplacementGroup(
                item_class=item_class,
                item_name=item_names.get(item_class) or item_class,
                recipe_ids=tuple(recipe_ids),
                base_recipe_ids=tuple(base_recipe_ids),
            )
        )

    result.sort(key=lambda group: (group.item_name.lower(), group.item_class))
    return tuple(result)


def _material_group_recipe_sort_key(recipe: Recipe, item_class: str) -> tuple[int, int, str, str]:
    relation_rank = 0 if recipe.outputs and recipe.outputs[0].item_class == item_class else 1
    alternate_rank, name, recipe_id = _replacement_group_recipe_sort_key(recipe)
    return relation_rank, alternate_rank, name, recipe_id


def _load_power_groups(rows: list[list[Any]]) -> tuple[PowerGroup, ...]:
    groups: dict[str, dict[str, Any]] = {}
    for row in _dict_rows(rows):
        group_class = _text(row.get("GroupClass"))
        member_class = _text(row.get("MemberClass"))
        if not group_class or not member_class:
            continue
        group = groups.setdefault(
            group_class,
            {
                "groupName": _text(row.get("GroupName")) or group_class,
                "members": [],
                "memberNames": [],
            },
        )
        if member_class in group["members"]:
            continue
        group["members"].append(member_class)
        group["memberNames"].append(_text(row.get("MemberName")) or member_class)

    result = [
        PowerGroup(
            group_class=group_class,
            group_name=group["groupName"],
            member_classes=tuple(group["members"]),
            member_names=tuple(group["memberNames"]),
        )
        for group_class, group in groups.items()
        if group["members"]
    ]
    result.sort(key=lambda group: (group.group_name.lower(), group.group_class))
    return tuple(result)


def _load_recipes(
    rows: list[list[Any]],
    inputs_by_recipe: dict[str, list[Ingredient]],
    outputs_by_recipe: dict[str, list[Ingredient]],
) -> tuple[Recipe, ...]:
    recipes: list[Recipe] = []
    for row in _dict_rows(rows):
        recipe_id = _text(row.get("RecipeID"))
        if not recipe_id:
            continue
        outputs = tuple(outputs_by_recipe.get(recipe_id, []))
        if not outputs:
            continue
        recipes.append(
            Recipe(
                recipe_id=recipe_id,
                name=_text(row.get("RecipeName")) or recipe_id,
                is_alternate=_bool(row.get("IsAlternate")),
                flags=tuple(_split_flags(row.get("RecipeFlag"))),
                produced_in=tuple(_split_csv(row.get("ProducedIn"))),
                produced_in_classes=tuple(_split_csv(row.get("ProducedInClasses"))),
                duration_sec=_float(row.get("DurationSec")),
                inputs=tuple(inputs_by_recipe.get(recipe_id, [])),
                outputs=outputs,
            )
        )
    return tuple(recipes)


def _replacement_group_recipe_sort_key(recipe: Recipe) -> tuple[int, str, str]:
    return (1 if recipe.is_alternate else 0, recipe.name.lower(), recipe.recipe_id)


def _recipe_has_flag(recipe: Recipe, flag: str) -> bool:
    return flag in recipe.flags


def _load_key_value_sheet(rows: list[list[Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for row in rows[1:]:
        if len(row) >= 2 and _text(row[0]):
            result[_text(row[0])] = row[1]
    return result


def _build_items(
    used_classes: set[str],
    producible_classes: set[str],
    item_names: dict[str, str],
    item_infos: dict[str, _ItemInfo],
    material_categories: dict[str, str],
) -> dict[str, Item]:
    items: dict[str, Item] = {}
    for class_name in used_classes:
        info = item_infos.get(class_name)
        category = material_categories.get(class_name, "")
        items[class_name] = Item(
            class_name=class_name,
            name=item_names.get(class_name) or (info.display_name if info else class_name),
            unit=(info.unit if info else "items") or "items",
            form=info.form if info else "",
            material_category=category,
            is_raw_resource=category == _MATERIAL_CATEGORY_RAW or (False if info is None else "FGResourceDescriptor" in info.native_class),
            producible=class_name in producible_classes,
            icon_path=info.icon_path if info else "",
        )
    return items


def _recipe_score(choice: RecipeChoice) -> int:
    recipe_name = _normalize(choice.recipe.name)
    item_name = _normalize(choice.output.item_name)
    score = 0
    if choice.recipe.is_alternate:
        score += 1000
    if recipe_name == item_name:
        score -= 80
    if item_name and item_name in recipe_name:
        score -= 30
    score += len(choice.recipe.inputs) * 4
    return score


def _normalize(value: Any) -> str:
    return _NON_ALNUM_RE.sub(" ", str(value or "").lower()).strip()


def _compact(value: Any) -> str:
    return _normalize(value).replace(" ", "")


def _split_csv(value: Any) -> list[str]:
    return [part.strip() for part in _text(value).split(",") if part.strip()]


def _split_flags(value: Any) -> list[str]:
    return [part.strip() for part in _text(value).split("|") if part.strip()]


def _static_data_path(path: str) -> str:
    cleaned = _text(path).replace("\\", "/").lstrip("/")
    if not cleaned:
        return ""
    if cleaned.startswith(("http://", "https://", "data/")):
        return cleaned
    return f"data/{cleaned}"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return _text(value).lower() in {"1", "true", "yes"}


def _display_noise_floor(scale: float) -> float:
    return max(_RESULT_EPS, abs(scale) * 1e-5)


def _clean_number(value: float) -> float | int:
    value = 0.0 if abs(value) <= _RESULT_EPS else value
    nearest_integer = round(value)
    if abs(value - nearest_integer) <= _display_noise_floor(max(abs(value), abs(nearest_integer), 1.0)):
        return int(nearest_integer)
    return round(value, 6)
