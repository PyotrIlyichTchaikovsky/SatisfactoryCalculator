from __future__ import annotations

import re
import sys
import zipfile
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree as ET

try:
    from scipy.optimize import linprog
except ImportError:  # pragma: no cover - handled at runtime with a clear planner error.
    linprog = None


DEFAULT_EXCEL_PATH = Path(__file__).resolve().parent.parent / "raw_data" / "Satisfactory_Recipes_Wide.xlsx"

_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_COLUMN_RE = re.compile(r"[A-Z]+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_LP_EPS = 1e-7
_RESULT_EPS = 1e-5


class PlannerError(ValueError):
    """Raised when planner input or source data is invalid."""


@dataclass(frozen=True)
class Item:
    class_name: str
    name: str
    unit: str
    form: str
    is_raw_resource: bool
    producible: bool


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
    produced_in: tuple[str, ...]
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


@dataclass(frozen=True)
class _ItemInfo:
    class_name: str
    display_name: str
    form: str
    unit: str
    native_class: str


class ProductionPlanner:
    def __init__(
        self,
        excel_path: Path,
        items: dict[str, Item],
        recipes: tuple[Recipe, ...],
        raw_source_classes: set[str],
        replacement_groups: tuple[ReplacementGroup, ...],
        version_info: dict[str, Any],
    ) -> None:
        self.excel_path = excel_path
        self.items = items
        self.recipes = recipes
        self.recipes_by_id = {recipe.recipe_id: recipe for recipe in recipes}
        self.version_info = version_info
        self.recipes_by_output = self._build_recipes_by_output(recipes)
        self.replacement_groups = replacement_groups
        self.replacement_groups_by_item = {group.item_class: group for group in replacement_groups}
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
        self.items_list = sorted(
            items.values(),
            key=lambda item: (not item.producible, item.name.lower(), item.class_name),
        )

    @classmethod
    def from_excel(cls, excel_path: str | Path = DEFAULT_EXCEL_PATH) -> "ProductionPlanner":
        path = Path(excel_path).expanduser().resolve()
        sheets = _load_xlsx_sheets(path)
        required_sheets = {"Items", "RawMaterials", "RecipesLong", "RecipeInputs", "RecipeOutputs"}
        missing = sorted(required_sheets - set(sheets))
        if missing:
            raise PlannerError(f"Excel workbook is missing required sheets: {', '.join(missing)}")

        item_infos = _load_item_infos(sheets["Items"])
        raw_source_classes = _load_raw_material_classes(sheets["RawMaterials"])
        inputs_by_recipe, input_item_names = _load_recipe_io(sheets["RecipeInputs"])
        outputs_by_recipe, output_item_names = _load_recipe_io(sheets["RecipeOutputs"])
        recipes = _load_recipes(sheets["RecipesLong"], inputs_by_recipe, outputs_by_recipe)
        version_info = _load_key_value_sheet(sheets.get("VersionInfo", []))
        replacement_groups = _load_replacement_groups(sheets.get("ReplacementGroup", []), recipes)

        used_classes = set(input_item_names) | set(output_item_names)
        producible_classes = set(output_item_names)
        item_names = {**input_item_names, **output_item_names}
        items = _build_items(used_classes, producible_classes, item_names, item_infos)
        return cls(path, items, recipes, raw_source_classes, replacement_groups, version_info)

    def summary(self) -> dict[str, Any]:
        return {
            "recipeCount": len(self.recipes),
            "itemCount": len(self.items),
            "rawMaterialCount": len(self.raw_source_classes),
            "excelPath": str(self.excel_path),
            "sourceDocsJson": self.version_info.get("SourceDocsJson", ""),
            "generatedAt": self.version_info.get("GeneratedAt", ""),
        }

    def list_items(self) -> list[dict[str, Any]]:
        return [self._item_to_dict(item) for item in self.items_list]

    def plan(
        self,
        targets: Iterable[dict[str, Any]],
        selected_recipes: Any | None = None,
    ) -> dict[str, Any]:
        parsed_targets = self._parse_targets(targets)
        recipe_selection_overrides = self._parse_recipe_selections(selected_recipes)
        active_recipe_ids, effective_selections = self._active_recipe_selection(recipe_selection_overrides)
        solution = self._solve_linear_plan(parsed_targets, active_recipe_ids)

        return {
            "targets": [
                {"item": self._item_to_dict(target["item"]), "rate": target["rate"]}
                for target in parsed_targets
            ],
            "selectedRecipes": effective_selections,
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
                "selectedRecipeCount": len(recipe_selection_overrides),
            },
        }

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
            if group and recipe_id in group.recipe_ids:
                selections[item_class] = recipe_id
        return selections

    def _active_recipe_selection(self, selected_recipes: dict[str, str]) -> tuple[set[str], dict[str, str]]:
        active_recipe_ids: set[str] = set()
        effective_selections: dict[str, str] = {}
        for group in self.replacement_groups:
            selected_recipe_id = selected_recipes.get(group.item_class) or group.recipe_ids[0]
            if selected_recipe_id not in group.recipe_ids:
                selected_recipe_id = group.recipe_ids[0]
            active_recipe_ids.add(selected_recipe_id)
            effective_selections[group.item_class] = selected_recipe_id
        return active_recipe_ids, effective_selections

    def _parse_targets(self, targets: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        parsed: list[dict[str, Any]] = []
        for index, target in enumerate(targets, start=1):
            if not isinstance(target, dict):
                raise PlannerError(f"Target #{index} must be an object.")
            item = self._resolve_item(target.get("itemClass") or target.get("itemName") or target.get("name"))
            try:
                rate = float(target.get("rate"))
            except (TypeError, ValueError) as exc:
                raise PlannerError(f"Target #{index} has an invalid rate.") from exc
            if rate <= 0:
                raise PlannerError(f"Target #{index} rate must be greater than 0.")
            parsed.append({"item": item, "rate": rate})
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
        raise PlannerError(f"Unknown item: {text}")

    def _solve_linear_plan(
        self,
        parsed_targets: list[dict[str, Any]],
        active_recipe_ids: set[str],
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
        raw_classes = sorted(self.raw_source_classes & set(material_classes))
        raw_index = {item_class: index for index, item_class in enumerate(raw_classes)}
        material_index = {item_class: index for index, item_class in enumerate(material_classes)}

        recipe_count = len(candidate_recipes)
        variable_count = recipe_count + len(raw_classes)
        net_matrix = [[0.0 for _ in range(variable_count)] for _ in material_classes]
        demand = [0.0 for _ in material_classes]

        for target in parsed_targets:
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

        recipe_runs = self._build_recipe_runs(candidate_recipes, values[:recipe_count])
        raw_supplies = {
            item_class: values[recipe_count + index]
            for item_class, index in raw_index.items()
            if values[recipe_count + index] > _RESULT_EPS
        }
        material_balances = self._build_material_balances(material_classes, parsed_targets, recipe_runs, raw_supplies)
        layers = self._build_plan_layers(parsed_targets, recipe_runs, raw_supplies)
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

        return {
            "recipeRuns": recipe_runs,
            "materialBalances": material_balances,
            "rawTotals": raw_totals,
            "layers": layers,
            "totals": totals,
            "objectiveValue": _clean_number(raw_minimum),
            "secondaryObjectiveValue": _clean_number(float(result.fun)),
        }

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
        classes.update(target["item"].class_name for target in parsed_targets)
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

    def _build_material_balances(
        self,
        material_classes: list[str],
        parsed_targets: list[dict[str, Any]],
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

        for target in parsed_targets:
            balances[target["item"].class_name]["targetDemand"] += target["rate"]

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
        parsed_targets: list[dict[str, Any]],
        recipe_runs: list[dict[str, Any]],
        raw_supplies: dict[str, float],
    ) -> list[dict[str, Any]]:
        layers: list[dict[str, Any]] = []
        remaining = {run["id"]: run for run in recipe_runs}
        demanded = {target["item"].class_name for target in parsed_targets}
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
                    "title": "目标产出" if layer_index == 0 else f"补给层 {layer_index}",
                    "kind": "recipes",
                    "recipeRuns": selected,
                }
            )
            demanded = {
                input_item["item"]["className"]
                for run in selected
                for input_item in run["inputs"]
                if input_item["item"]["className"] not in self.raw_source_classes
            }
            layer_index += 1

        if remaining:
            shared_runs = sorted(
                remaining.values(),
                key=lambda run: (run["recipe"]["name"].lower(), run["recipe"]["id"]),
            )
            layers.append(
                {
                    "title": "共享 / 闭环补给",
                    "kind": "recipes",
                    "recipeRuns": shared_runs,
                }
            )

        if raw_supplies:
            layers.append(
                {
                    "title": "外部原材料输入",
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
        return 1.0

    def _is_terminal_raw(self, item: Item) -> bool:
        return item.class_name in self.raw_source_classes

    def _item_for_class(self, item_class: str) -> Item:
        return self.items.get(
            item_class,
            Item(
                class_name=item_class,
                name=item_class,
                unit="items",
                form="",
                is_raw_resource=False,
                producible=False,
            ),
        )

    def _item_to_dict(self, item: Item) -> dict[str, Any]:
        return {
            "className": item.class_name,
            "name": item.name,
            "unit": item.unit,
            "form": item.form,
            "isRawResource": item.is_raw_resource,
            "producible": item.producible,
        }

    def _recipe_to_dict(self, recipe: Recipe) -> dict[str, Any]:
        primary_output = recipe.outputs[0] if recipe.outputs else None
        primary_item_class = primary_output.item_class if primary_output else ""
        group = self.replacement_group_by_recipe.get(recipe.recipe_id)
        group_recipe_ids = group.recipe_ids if group else (recipe.recipe_id,)
        return {
            "id": recipe.recipe_id,
            "name": recipe.name,
            "isAlternate": recipe.is_alternate,
            "producedIn": list(recipe.produced_in),
            "durationSec": _clean_number(recipe.duration_sec),
            "primaryOutput": self._item_to_dict(self._item_for_class(primary_item_class)) if primary_item_class else None,
            "defaultRecipeId": group_recipe_ids[0] if group_recipe_ids else recipe.recipe_id,
            "replacementOptions": [
                self._recipe_option_to_dict(self.recipes_by_id[recipe_id])
                for recipe_id in group_recipe_ids
                if recipe_id in self.recipes_by_id
            ],
        }

    def _recipe_option_to_dict(self, recipe: Recipe) -> dict[str, Any]:
        return {
            "id": recipe.recipe_id,
            "name": recipe.name,
            "isAlternate": recipe.is_alternate,
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
    return rows


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


def _load_item_infos(rows: list[list[Any]]) -> dict[str, _ItemInfo]:
    infos: dict[str, _ItemInfo] = {}
    for row in _dict_rows(rows):
        class_name = _text(row.get("ClassName"))
        if not class_name:
            continue
        infos[class_name] = _ItemInfo(
            class_name=class_name,
            display_name=_text(row.get("DisplayName")) or class_name,
            form=_text(row.get("Form")),
            unit=_text(row.get("Unit")) or "items",
            native_class=_text(row.get("NativeClass")),
        )
    return infos


def _load_raw_material_classes(rows: list[list[Any]]) -> set[str]:
    raw_classes: set[str] = set()
    for row in _dict_rows(rows):
        item_class = _text(row.get("ItemClass") or row.get("ClassName"))
        if item_class:
            raw_classes.add(item_class)
    if not raw_classes:
        raise PlannerError("RawMaterials sheet must contain at least one ItemClass.")
    return raw_classes


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
                produced_in=tuple(_split_csv(row.get("ProducedIn"))),
                duration_sec=_float(row.get("DurationSec")),
                inputs=tuple(inputs_by_recipe.get(recipe_id, [])),
                outputs=outputs,
            )
        )
    return tuple(recipes)


def _load_replacement_groups(rows: list[list[Any]], recipes: tuple[Recipe, ...]) -> tuple[ReplacementGroup, ...]:
    sheet_order = _replacement_sheet_recipe_order(rows)
    groups: dict[str, list[Recipe]] = defaultdict(list)
    for recipe in recipes:
        if recipe.outputs:
            groups[recipe.outputs[0].item_class].append(recipe)

    result: list[ReplacementGroup] = []
    for item_class, group_recipes in groups.items():
        if not group_recipes:
            continue
        output = group_recipes[0].outputs[0]
        order_by_name = {
            recipe_name: index
            for index, recipe_name in enumerate(sheet_order.get(output.item_name, []))
        }
        sorted_recipes = sorted(
            group_recipes,
            key=lambda recipe: (
                order_by_name.get(recipe.name, len(order_by_name)),
                _replacement_group_recipe_sort_key(recipe),
            ),
        )
        result.append(
            ReplacementGroup(
                item_class=item_class,
                item_name=output.item_name,
                recipe_ids=tuple(recipe.recipe_id for recipe in sorted_recipes),
            )
        )

    result.sort(key=lambda group: (group.item_name.lower(), group.item_class))
    return tuple(result)


def _replacement_sheet_recipe_order(rows: list[list[Any]]) -> dict[str, list[str]]:
    order: dict[str, list[str]] = defaultdict(list)
    current_output_name = ""
    for row in _dict_rows(rows):
        output_name = _text(row.get("产出材料名称"))
        if output_name:
            current_output_name = output_name
        recipe_name = _text(row.get("配方名称"))
        if current_output_name and recipe_name:
            order[current_output_name].append(recipe_name)
    return dict(order)


def _replacement_group_recipe_sort_key(recipe: Recipe) -> tuple[int, str, str]:
    return (1 if recipe.is_alternate else 0, recipe.name.lower(), recipe.recipe_id)


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
) -> dict[str, Item]:
    items: dict[str, Item] = {}
    for class_name in used_classes:
        info = item_infos.get(class_name)
        items[class_name] = Item(
            class_name=class_name,
            name=item_names.get(class_name) or (info.display_name if info else class_name),
            unit=(info.unit if info else "items") or "items",
            form=info.form if info else "",
            is_raw_resource=False if info is None else "FGResourceDescriptor" in info.native_class,
            producible=class_name in producible_classes,
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


def _clean_number(value: float) -> float | int:
    if abs(value - round(value)) < 1e-9:
        return int(round(value))
    return round(value, 6)
