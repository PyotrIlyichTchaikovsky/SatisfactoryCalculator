from __future__ import annotations

import re
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable
from xml.etree import ElementTree as ET


DEFAULT_EXCEL_PATH = Path(__file__).resolve().parent.parent / "raw_data" / "Satisfactory_Recipes_Wide.xlsx"

_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_COLUMN_RE = re.compile(r"[A-Z]+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


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
        version_info: dict[str, Any],
    ) -> None:
        self.excel_path = excel_path
        self.items = items
        self.recipes = recipes
        self.version_info = version_info
        self.recipes_by_output = self._build_recipes_by_output(recipes)
        self.items_list = sorted(
            items.values(),
            key=lambda item: (not item.producible, item.name.lower(), item.class_name),
        )

    @classmethod
    def from_excel(cls, excel_path: str | Path = DEFAULT_EXCEL_PATH) -> "ProductionPlanner":
        path = Path(excel_path).expanduser().resolve()
        sheets = _load_xlsx_sheets(path)
        required_sheets = {"Items", "RecipesLong", "RecipeInputs", "RecipeOutputs"}
        missing = sorted(required_sheets - set(sheets))
        if missing:
            raise PlannerError(f"Excel workbook is missing required sheets: {', '.join(missing)}")

        item_infos = _load_item_infos(sheets["Items"])
        inputs_by_recipe, input_item_names = _load_recipe_io(sheets["RecipeInputs"])
        outputs_by_recipe, output_item_names = _load_recipe_io(sheets["RecipeOutputs"])
        recipes = _load_recipes(sheets["RecipesLong"], inputs_by_recipe, outputs_by_recipe)
        version_info = _load_key_value_sheet(sheets.get("VersionInfo", []))

        used_classes = set(input_item_names) | set(output_item_names)
        producible_classes = set(output_item_names)
        item_names = {**input_item_names, **output_item_names}
        items = _build_items(used_classes, producible_classes, item_names, item_infos)
        return cls(path, items, recipes, version_info)

    def summary(self) -> dict[str, Any]:
        return {
            "recipeCount": len(self.recipes),
            "itemCount": len(self.items),
            "excelPath": str(self.excel_path),
            "sourceDocsJson": self.version_info.get("SourceDocsJson", ""),
            "generatedAt": self.version_info.get("GeneratedAt", ""),
        }

    def list_items(self) -> list[dict[str, Any]]:
        return [self._item_to_dict(item) for item in self.items_list]

    def plan(self, targets: Iterable[dict[str, Any]]) -> dict[str, Any]:
        parsed_targets = self._parse_targets(targets)
        roots = [
            self._build_tree(target["item"].class_name, target["rate"], [], f"root-{index}")
            for index, target in enumerate(parsed_targets)
        ]
        totals: dict[str, dict[str, Any]] = {}
        for root in roots:
            self._collect_totals(root, totals, is_root=True)

        total_rows = sorted(
            totals.values(),
            key=lambda row: (row["raw"], row["item"]["name"].lower(), row["item"]["className"]),
        )
        for row in total_rows:
            row["recipes"] = sorted(row["recipes"])

        return {
            "targets": [
                {"item": self._item_to_dict(target["item"]), "rate": target["rate"]}
                for target in parsed_targets
            ],
            "roots": roots,
            "totals": total_rows,
            "summary": {
                "targetCount": len(parsed_targets),
                "totalRows": len(total_rows),
            },
        }

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

    def _build_tree(self, item_class: str, rate: float, path: list[str], node_key: str) -> dict[str, Any]:
        item = self._item_for_class(item_class)
        node: dict[str, Any] = {
            "key": node_key,
            "item": self._item_to_dict(item),
            "rate": _clean_number(rate),
            "children": [],
            "recipe": None,
            "choiceCount": 0,
            "raw": False,
            "cycle": False,
        }

        if item_class in path:
            node["cycle"] = True
            return node

        if item.is_raw_resource:
            node["raw"] = True
            return node

        choices = self.recipes_by_output.get(item_class, [])
        node["choiceCount"] = len(choices)
        if not choices:
            node["raw"] = True
            return node

        choice = choices[0]
        output_rate = choice.output.per_min
        if output_rate <= 0:
            node["raw"] = True
            return node

        scale = rate / output_rate
        node["recipe"] = self._recipe_to_dict(choice.recipe)
        next_path = [*path, item_class]
        node["children"] = [
            self._build_tree(
                input_item.item_class,
                input_item.per_min * scale,
                next_path,
                f"{node_key}.{index}-{input_item.item_class}",
            )
            for index, input_item in enumerate(choice.recipe.inputs)
        ]
        return node

    def _collect_totals(self, node: dict[str, Any], totals: dict[str, dict[str, Any]], is_root: bool) -> None:
        if not is_root:
            item_class = node["item"]["className"]
            current = totals.get(item_class)
            if current is None:
                item = self._item_for_class(item_class)
                current = {
                    "item": self._item_to_dict(item),
                    "rate": 0.0,
                    "raw": self._is_terminal_raw(item),
                    "recipes": set(),
                }
                totals[item_class] = current
            current["rate"] += float(node["rate"])
            current["rate"] = _clean_number(current["rate"])
            current["raw"] = bool(current["raw"] or node["raw"])
            if node.get("recipe"):
                current["recipes"].add(node["recipe"]["name"])

        for child in node["children"]:
            self._collect_totals(child, totals, is_root=False)

    def _is_terminal_raw(self, item: Item) -> bool:
        return item.is_raw_resource or not self.recipes_by_output.get(item.class_name)

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
        return {
            "id": recipe.recipe_id,
            "name": recipe.name,
            "isAlternate": recipe.is_alternate,
            "producedIn": list(recipe.produced_in),
            "durationSec": _clean_number(recipe.duration_sec),
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