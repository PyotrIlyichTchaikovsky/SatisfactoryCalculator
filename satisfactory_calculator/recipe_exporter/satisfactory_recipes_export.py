#!/usr/bin/env python3
"""Export Satisfactory Docs.json recipes to a wide Excel workbook.

The script intentionally reads only recipes already present in Docs.json. It
does not invent miner, water extractor, oil extractor, or other extraction
rules.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence
from xml.sax.saxutils import escape


SCRIPT_VERSION = "0.1.0"
CONFIG_FILE_NAME = "satisfactory_recipes_export.config.json"
EXCEL_FILE_NAME = "Satisfactory_Recipes_Wide.xlsx"
PLANNER_DATA_FILE_NAME = "satisfactory_planner_data.js"
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
RAW_DATA_DIR = PROJECT_ROOT / "raw_data"
RECIPE_WEB_DIR = PROJECT_ROOT / "recipe_web"

RECIPE_NATIVE_CLASS = "FGRecipe"
ITEM_AMOUNT_RE = re.compile(
    r"ItemClass\s*=\s*\"?[^']*'(?P<path>[^']+)'\"?\s*,\s*Amount\s*=\s*(?P<amount>[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)",
    re.IGNORECASE,
)
CLASS_PATH_RE = re.compile(r"'(?P<path>/[^']+)'")
INVALID_XML_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


@dataclass(frozen=True)
class ItemInfo:
    class_name: str
    display_name: str
    form: str = ""
    unit: str = "items"
    stack_size: str = ""
    sink_points: str = ""
    native_class: str = ""


@dataclass(frozen=True)
class Ingredient:
    item_class: str
    item_name: str
    raw_amount: float
    amount: float
    unit: str
    per_min: float


@dataclass
class Recipe:
    recipe_id: str
    recipe_name: str
    is_alternate: bool
    produced_in: list[str]
    produced_in_classes: list[str]
    duration_sec: float
    inputs: list[Ingredient] = field(default_factory=list)
    outputs: list[Ingredient] = field(default_factory=list)
    source_class: str = ""
    source_file: str = ""


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        docs_path = resolve_docs_path(args)
        data = load_json(docs_path)
        classes = list(iter_docs_classes(data))
        display_names = build_display_name_index(classes)
        items = build_item_index(classes, display_names)
        recipes = build_recipes(classes, display_names, items, docs_path)
        recipes = filter_recipes(recipes, args)
        recipes.sort(key=lambda recipe: (", ".join(recipe.produced_in).lower(), recipe.recipe_name.lower(), recipe.is_alternate))

        sheets = build_sheets(recipes, items, docs_path, args)
        write_xlsx(args.out, sheets)
        planner_data_path = RECIPE_WEB_DIR / PLANNER_DATA_FILE_NAME
        write_planner_data_js(planner_data_path, recipes, items, docs_path)

        if args.debug_json:
            write_debug_json(args.out, recipes, items, docs_path)

        print(f"Wrote {args.out}")
        print(f"Planner data: {planner_data_path}")
        print(f"Recipes: {len(recipes)}")
        print(f"Source: {docs_path}")
        return 0
    except ExportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    default_config_path = SCRIPT_DIR / CONFIG_FILE_NAME
    config_pre_parser = argparse.ArgumentParser(add_help=False)
    config_pre_parser.add_argument(
        "--config",
        type=Path,
        default=default_config_path,
        help="Path to a local JSON config file.",
    )

    parser = argparse.ArgumentParser(
        description="Export Satisfactory Docs.json recipes to a wide XLSX workbook.",
        parents=[config_pre_parser],
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--game-dir", type=Path, default=argparse.SUPPRESS, help="Satisfactory install directory.")
    source.add_argument("--docs-json", type=Path, default=argparse.SUPPRESS, help="Direct path to Docs.json.")
    source.add_argument("--auto", action="store_true", default=argparse.SUPPRESS, help="Search common install locations.")

    parser.add_argument(
        "--out",
        type=Path,
        default=argparse.SUPPRESS,
        help="Output .xlsx file path.",
    )
    parser.add_argument("--lang", default=argparse.SUPPRESS, help="Accepted for CLI compatibility; Docs.json is used as-is.")
    parser.add_argument("--wide-only", action="store_true", default=argparse.SUPPRESS, help="Write only the RecipesWide sheet.")
    parser.add_argument("--debug-json", action="store_true", default=argparse.SUPPRESS, help="Also write parsed intermediate JSON next to the workbook.")

    parsed = parser.parse_args(argv)
    parsed_values = vars(parsed).copy()
    config_path = resolve_cli_path(parsed_values.pop("config"))

    values = default_arg_values()
    values["config"] = config_path
    if config_path.is_file():
        try:
            values.update(load_config_values(config_path))
        except ExportError as exc:
            parser.error(str(exc))
    elif is_config_explicit(argv):
        parser.error(f"config file does not exist: {config_path}")

    values.update(parsed_values)
    args = argparse.Namespace(**values)

    if not args.game_dir and not args.docs_json and not args.auto:
        parser.error("provide --game-dir, --docs-json, or --auto")
    return args


def default_arg_values() -> dict[str, Any]:
    return {
        "game_dir": None,
        "docs_json": None,
        "auto": False,
        "out": RAW_DATA_DIR / EXCEL_FILE_NAME,
        "lang": "en-US",
        "wide_only": False,
        "debug_json": False,
    }


def resolve_cli_path(path: Path) -> Path:
    expanded = path.expanduser()
    if expanded.is_absolute():
        return expanded
    return (Path.cwd() / expanded).resolve()


def load_config_values(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            raw = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ExportError(f"config file is not valid JSON: {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ExportError(f"config file must contain a JSON object: {path}")

    allowed = set(default_arg_values())
    config_keys = {key for key in raw if not key.startswith("_")}
    unknown = sorted(config_keys - allowed)
    if unknown:
        raise ExportError(f"unknown config key(s): {', '.join(unknown)}")

    values: dict[str, Any] = {}
    base_dir = path.parent
    for key, value in raw.items():
        if key.startswith("_"):
            continue
        if key in {"game_dir", "docs_json"}:
            values[key] = optional_path_value(key, value, base_dir)
        elif key == "out":
            values[key] = required_path_value(key, value, base_dir)
        elif key in {
            "auto",
            "wide_only",
            "debug_json",
        }:
            values[key] = bool_value(key, value)
        elif key == "lang":
            values[key] = "" if value is None else str(value)
    return values


def optional_path_value(key: str, value: Any, base_dir: Path) -> Path | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ExportError(f"config key {key!r} must be a string path or null")
    return resolve_config_path(value, base_dir)


def required_path_value(key: str, value: Any, base_dir: Path) -> Path:
    if not isinstance(value, str) or not value:
        raise ExportError(f"config key {key!r} must be a non-empty string path")
    return resolve_config_path(value, base_dir)


def resolve_config_path(value: str, base_dir: Path) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def bool_value(key: str, value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise ExportError(f"config key {key!r} must be true or false")


def is_config_explicit(argv: Sequence[str] | None) -> bool:
    values = list(sys.argv[1:] if argv is None else argv)
    return "--config" in values or any(value.startswith("--config=") for value in values)


class ExportError(RuntimeError):
    pass


def load_json(path: Path) -> Any:
    try:
        data = path.read_bytes()
        if data.startswith((b"\xff\xfe", b"\xfe\xff")):
            text = data.decode("utf-16")
        else:
            text = data.decode("utf-8-sig")
        return json.loads(text)
    except FileNotFoundError as exc:
        raise ExportError(f"Docs.json not found: {path}") from exc
    except UnicodeDecodeError as exc:
        raise ExportError(f"Docs.json uses an unsupported text encoding: {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ExportError(f"Docs.json is not valid JSON: {path}: {exc}") from exc


def resolve_docs_path(args: argparse.Namespace) -> Path:
    if args.docs_json:
        path = args.docs_json.expanduser().resolve()
        if path.is_file():
            return path
        raise ExportError(f"--docs-json does not exist: {path}")

    candidates: list[Path] = []
    if args.game_dir:
        candidates.extend(candidate_docs_paths(args.game_dir, args.lang))
    elif args.auto:
        for game_dir in common_game_dirs():
            candidates.extend(candidate_docs_paths(game_dir, args.lang))

    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()

    lines = ["could not find Docs.json. Checked:"]
    lines.extend(f"  {candidate}" for candidate in candidates)
    raise ExportError("\n".join(lines))


def candidate_docs_paths(game_dir: Path, lang: str = "en-US") -> list[Path]:
    base = game_dir.expanduser()
    docs_names = []
    if lang:
        docs_names.append(f"{lang}.json")
    docs_names.extend(["en-US.json", "Docs.json"])
    docs_names = list(dict.fromkeys(docs_names))

    paths: list[Path] = []
    for docs_name in docs_names:
        paths.append(base / "CommunityResources" / "Docs" / docs_name)
    for docs_name in docs_names:
        paths.append(base / "FactoryGame" / "CommunityResources" / "Docs" / docs_name)
    paths.append(base / "Docs.json")
    return [
        *paths,
    ]


def common_game_dirs() -> list[Path]:
    roots = [
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam" / "steamapps" / "common" / "Satisfactory",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Steam" / "steamapps" / "common" / "Satisfactory",
    ]
    for drive in "CDEFGHI":
        roots.append(Path(f"{drive}:\\SteamLibrary\\steamapps\\common\\Satisfactory"))
    return roots


def iter_docs_classes(data: Any) -> Iterable[tuple[str, dict[str, Any]]]:
    groups: Any
    if isinstance(data, list):
        groups = data
    elif isinstance(data, dict):
        groups = data.get("NativeClasses") or data.get("nativeClasses") or data.get("Classes") or []
    else:
        groups = []

    for group in groups:
        if not isinstance(group, dict):
            continue
        native_class = str(group.get("NativeClass") or group.get("nativeClass") or "")
        classes = group.get("Classes") or group.get("classes") or []
        if isinstance(classes, dict):
            classes = classes.values()
        for class_obj in classes:
            if isinstance(class_obj, dict):
                yield native_class, class_obj


def build_display_name_index(classes: Sequence[tuple[str, dict[str, Any]]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for _native_class, obj in classes:
        class_name = string_value(obj.get("ClassName"))
        if not class_name:
            continue
        display_name = string_value(obj.get("mDisplayName")) or humanize_class_name(class_name)
        index[class_name] = display_name
        if class_name.endswith("_C"):
            index[class_name[:-2]] = display_name
    return index


def build_item_index(
    classes: Sequence[tuple[str, dict[str, Any]]],
    display_names: dict[str, str],
) -> dict[str, ItemInfo]:
    items: dict[str, ItemInfo] = {}
    for native_class, obj in classes:
        class_name = string_value(obj.get("ClassName"))
        if not class_name:
            continue

        is_item = class_name.startswith("Desc_") or bool(obj.get("mForm"))
        if not is_item:
            continue

        form = string_value(obj.get("mForm"))
        unit = unit_for_form(form)
        info = ItemInfo(
            class_name=class_name,
            display_name=display_names.get(class_name, humanize_class_name(class_name)),
            form=form,
            unit=unit,
            stack_size=string_value(obj.get("mStackSize")),
            sink_points=string_value(obj.get("mResourceSinkPoints")),
            native_class=native_class,
        )
        items[class_name] = info
        if class_name.endswith("_C"):
            items[class_name[:-2]] = info
    return items


def build_recipes(
    classes: Sequence[tuple[str, dict[str, Any]]],
    display_names: dict[str, str],
    items: dict[str, ItemInfo],
    docs_path: Path,
) -> list[Recipe]:
    recipes: list[Recipe] = []
    source_file = str(docs_path)

    for native_class, obj in classes:
        if RECIPE_NATIVE_CLASS not in native_class:
            continue
        class_name = string_value(obj.get("ClassName"))
        if not class_name:
            continue

        duration = float_value(obj.get("mManufactoringDuration") or obj.get("mManufacturingDuration"))
        product_value = obj.get("mProduct") if obj.get("mProduct") is not None else obj.get("mProducts")
        input_items = parse_item_amounts(obj.get("mIngredients"), items)
        output_items = parse_item_amounts(product_value, items)
        if not output_items:
            continue

        produced_in_classes = extract_class_refs(obj.get("mProducedIn"))
        produced_in = [display_names.get(cls, humanize_class_name(cls)) for cls in produced_in_classes]
        recipe_name = string_value(obj.get("mDisplayName")) or display_names.get(class_name) or humanize_class_name(class_name)

        recipe = Recipe(
            recipe_id=class_name,
            recipe_name=recipe_name,
            is_alternate=is_alternate_recipe(class_name, recipe_name),
            produced_in=produced_in,
            produced_in_classes=produced_in_classes,
            duration_sec=duration,
            inputs=with_per_min(input_items, duration, is_output=False),
            outputs=with_per_min(output_items, duration, is_output=True),
            source_class=native_class,
            source_file=source_file,
        )
        recipes.append(recipe)

    return recipes


def parse_item_amounts(value: Any, items: dict[str, ItemInfo]) -> list[Ingredient]:
    text = string_value(value)
    if not text or text == "()":
        return []

    parsed: list[Ingredient] = []
    for match in ITEM_AMOUNT_RE.finditer(text):
        class_name = class_name_from_path(match.group("path"))
        raw_amount = float_value(match.group("amount"))
        item = items.get(class_name) or items.get(class_name.removesuffix("_C"))
        form = item.form if item else ""
        unit = item.unit if item else unit_for_form(form)
        amount = normalized_amount(raw_amount, unit)
        parsed.append(
            Ingredient(
                item_class=class_name,
                item_name=item.display_name if item else humanize_class_name(class_name),
                raw_amount=raw_amount,
                amount=amount,
                unit=unit,
                per_min=0.0,
            )
        )
    return parsed


def with_per_min(items: Sequence[Ingredient], duration: float, is_output: bool) -> list[Ingredient]:
    if duration <= 0:
        return list(items)
    multiplier = 60.0 / duration
    result: list[Ingredient] = []
    for item in items:
        result.append(
            Ingredient(
                item_class=item.item_class,
                item_name=item.item_name,
                raw_amount=item.raw_amount,
                amount=item.amount,
                unit=item.unit,
                per_min=item.amount * multiplier,
            )
        )
    return result


def filter_recipes(recipes: Sequence[Recipe], args: argparse.Namespace) -> list[Recipe]:
    result: list[Recipe] = []
    for recipe in recipes:
        if is_extraction_recipe(recipe):
            continue
        result.append(recipe)
    return result


def is_extraction_recipe(recipe: Recipe) -> bool:
    haystack = " ".join(recipe.produced_in + recipe.produced_in_classes).lower()
    tokens = [
        "miner",
        "water extractor",
        "waterextractor",
        "water pump",
        "waterpump",
        "oil extractor",
        "oilextractor",
        "oil pump",
        "oilpump",
        "resource well",
        "fracking",
    ]
    return any(token in haystack for token in tokens)


def build_sheets(
    recipes: Sequence[Recipe],
    items: dict[str, ItemInfo],
    docs_path: Path,
    args: argparse.Namespace,
) -> list[tuple[str, list[list[Any]]]]:
    wide_rows = build_recipes_wide_rows(recipes)
    if args.wide_only:
        return [("RecipesWide", wide_rows)]

    unique_items = sorted(
        {info.class_name: info for info in items.values()}.values(),
        key=lambda item: item.display_name.lower(),
    )
    sheets = [
        ("README", build_readme_rows(recipes, items, docs_path, args)),
        ("RecipesWide", wide_rows),
        ("Items", build_items_rows(unique_items)),
        ("RecipesLong", build_recipes_long_rows(recipes)),
        ("RecipeInputs", build_recipe_io_rows(recipes, input_side=True)),
        ("RecipeOutputs", build_recipe_io_rows(recipes, input_side=False)),
        ("VersionInfo", build_version_rows(docs_path, args)),
        ("Validation", build_validation_rows(recipes, unique_items)),
    ]
    return sheets


def build_recipes_wide_rows(recipes: Sequence[Recipe]) -> list[list[Any]]:
    max_inputs = max((len(recipe.inputs) for recipe in recipes), default=0)
    max_outputs = max((len(recipe.outputs) for recipe in recipes), default=0)

    headers: list[str] = [
        "RecipeID",
        "RecipeName",
        "IsAlternate",
        "ProducedIn",
        "DurationSec",
        "InputsText",
        "OutputsText",
    ]
    for index in range(1, max_inputs + 1):
        headers.extend([f"Input{index}Item", f"Input{index}Amount", f"Input{index}Unit", f"Input{index}PerMin"])
    for index in range(1, max_outputs + 1):
        headers.extend([f"Output{index}Item", f"Output{index}Amount", f"Output{index}Unit", f"Output{index}PerMin"])
    headers.extend(["SourceClass", "SourceFile"])

    rows: list[list[Any]] = [headers]
    for recipe in recipes:
        row: list[Any] = [
            recipe.recipe_id,
            recipe.recipe_name,
            recipe.is_alternate,
            ", ".join(recipe.produced_in),
            clean_number(recipe.duration_sec),
            format_io_text(recipe.inputs),
            format_io_text(recipe.outputs),
        ]
        for index in range(max_inputs):
            row.extend(io_wide_cells(recipe.inputs[index] if index < len(recipe.inputs) else None))
        for index in range(max_outputs):
            row.extend(io_wide_cells(recipe.outputs[index] if index < len(recipe.outputs) else None))
        row.extend([recipe.source_class, recipe.source_file])
        rows.append(row)
    return rows


def build_readme_rows(
    recipes: Sequence[Recipe],
    items: dict[str, ItemInfo],
    docs_path: Path,
    args: argparse.Namespace,
) -> list[list[Any]]:
    return [
        ["Key", "Value"],
        ["Purpose", "Export real Docs.json recipes to a human-readable wide workbook."],
        ["MainSheet", "RecipesWide"],
        ["ConfigFile", str(args.config)],
        ["NoGeneratedExtractionRules", True],
        ["FilteringRule", "Only extraction/raw-resource gathering recipes are excluded; all other real Docs recipes are included."],
        ["RecipeCount", len(recipes)],
        ["KnownItemCount", len({item.class_name for item in items.values()})],
        ["SourceDocsJson", str(docs_path)],
    ]


def build_items_rows(items: Sequence[ItemInfo]) -> list[list[Any]]:
    rows = [["ClassName", "DisplayName", "Form", "Unit", "StackSize", "ResourceSinkPoints", "NativeClass"]]
    for item in items:
        rows.append([item.class_name, item.display_name, item.form, item.unit, item.stack_size, item.sink_points, item.native_class])
    return rows


def build_recipes_long_rows(recipes: Sequence[Recipe]) -> list[list[Any]]:
    rows = [
        [
            "RecipeID",
            "RecipeName",
            "IsAlternate",
            "ProducedIn",
            "DurationSec",
            "InputCount",
            "OutputCount",
            "SourceClass",
            "SourceFile",
        ]
    ]
    for recipe in recipes:
        rows.append(
            [
                recipe.recipe_id,
                recipe.recipe_name,
                recipe.is_alternate,
                ", ".join(recipe.produced_in),
                clean_number(recipe.duration_sec),
                len(recipe.inputs),
                len(recipe.outputs),
                recipe.source_class,
                recipe.source_file,
            ]
        )
    return rows


def build_recipe_io_rows(recipes: Sequence[Recipe], input_side: bool) -> list[list[Any]]:
    rows = [
        [
            "RecipeID",
            "RecipeName",
            "Index",
            "ItemClass",
            "ItemName",
            "RawAmount",
            "Amount",
            "Unit",
            "AmountPerMin",
        ]
    ]
    for recipe in recipes:
        values = recipe.inputs if input_side else recipe.outputs
        for index, item in enumerate(values, start=1):
            rows.append(
                [
                    recipe.recipe_id,
                    recipe.recipe_name,
                    index,
                    item.item_class,
                    item.item_name,
                    clean_number(item.raw_amount),
                    clean_number(item.amount),
                    item.unit,
                    clean_number(item.per_min),
                ]
            )
    return rows


def build_version_rows(docs_path: Path, args: argparse.Namespace) -> list[list[Any]]:
    return [
        ["Key", "Value"],
        ["ScriptVersion", SCRIPT_VERSION],
        ["GeneratedAt", dt.datetime.now(dt.timezone.utc).isoformat()],
        ["ConfigFile", str(args.config)],
        ["GameDir", "" if args.game_dir is None else str(args.game_dir)],
        ["DocsJson", "" if args.docs_json is None else str(args.docs_json)],
        ["Auto", args.auto],
        ["SourceDocsJson", str(docs_path)],
        ["Output", str(args.out)],
        ["Lang", args.lang],
        ["RecipeFilter", "exclude extraction/raw-resource gathering recipes only"],
        ["WideOnly", args.wide_only],
        ["DebugJson", args.debug_json],
    ]


def build_validation_rows(recipes: Sequence[Recipe], items: Sequence[ItemInfo]) -> list[list[Any]]:
    no_inputs = sum(1 for recipe in recipes if not recipe.inputs)
    no_producers = sum(1 for recipe in recipes if not recipe.produced_in)
    alternate = sum(1 for recipe in recipes if recipe.is_alternate)
    max_inputs = max((len(recipe.inputs) for recipe in recipes), default=0)
    max_outputs = max((len(recipe.outputs) for recipe in recipes), default=0)
    return [
        ["Metric", "Value"],
        ["RecipeCount", len(recipes)],
        ["ItemCount", len(items)],
        ["AlternateRecipeCount", alternate],
        ["RecipesWithoutInputs", no_inputs],
        ["RecipesWithoutProducedIn", no_producers],
        ["MaxInputCount", max_inputs],
        ["MaxOutputCount", max_outputs],
    ]


def io_wide_cells(item: Ingredient | None) -> list[Any]:
    if item is None:
        return ["", "", "", ""]
    return [item.item_name, clean_number(item.amount), item.unit, clean_number(item.per_min)]


def format_io_text(items: Sequence[Ingredient]) -> str:
    return "; ".join(f"{format_number(item.amount)} {item.unit} {item.item_name}" for item in items)


def write_debug_json(out_path: Path, recipes: Sequence[Recipe], items: dict[str, ItemInfo], docs_path: Path) -> None:
    debug_path = out_path.with_suffix(".debug.json")
    payload = {
        "script_version": SCRIPT_VERSION,
        "source_docs_json": str(docs_path),
        "recipes": [
            {
                "recipe_id": recipe.recipe_id,
                "recipe_name": recipe.recipe_name,
                "is_alternate": recipe.is_alternate,
                "produced_in": recipe.produced_in,
                "duration_sec": recipe.duration_sec,
                "inputs": [ingredient_to_dict(item) for item in recipe.inputs],
                "outputs": [ingredient_to_dict(item) for item in recipe.outputs],
                "source_class": recipe.source_class,
            }
            for recipe in recipes
        ],
        "items": {
            item.class_name: {
                "display_name": item.display_name,
                "form": item.form,
                "unit": item.unit,
                "stack_size": item.stack_size,
                "sink_points": item.sink_points,
                "native_class": item.native_class,
            }
            for item in {info.class_name: info for info in items.values()}.values()
        },
    }
    with debug_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def write_planner_data_js(path: Path, recipes: Sequence[Recipe], items: dict[str, ItemInfo], docs_path: Path) -> None:
    item_infos = {info.class_name: info for info in items.values()}
    used_items: dict[str, dict[str, Any]] = {}
    producible_classes: set[str] = set()

    for recipe in recipes:
        for item in recipe.outputs:
            producible_classes.add(item.item_class)
            remember_planner_item(used_items, item_infos, item)
        for item in recipe.inputs:
            remember_planner_item(used_items, item_infos, item)

    payload = {
        "scriptVersion": SCRIPT_VERSION,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sourceDocsJson": str(docs_path),
        "recipeCount": len(recipes),
        "items": sorted(
            (
                {
                    **item,
                    "producible": class_name in producible_classes,
                }
                for class_name, item in used_items.items()
            ),
            key=lambda value: (not value["producible"], value["name"].lower(), value["className"]),
        ),
        "recipes": [
            {
                "id": recipe.recipe_id,
                "name": recipe.recipe_name,
                "isAlternate": recipe.is_alternate,
                "producedIn": recipe.produced_in,
                "durationSec": clean_number(recipe.duration_sec),
                "inputs": [planner_ingredient_to_dict(item) for item in recipe.inputs],
                "outputs": [planner_ingredient_to_dict(item) for item in recipe.outputs],
            }
            for recipe in recipes
        ],
    }
    js = "window.SATISFACTORY_PLANNER_DATA = "
    js += json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    js += ";\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(js, encoding="utf-8")


def remember_planner_item(
    used_items: dict[str, dict[str, Any]],
    item_infos: dict[str, ItemInfo],
    ingredient: Ingredient,
) -> None:
    info = item_infos.get(ingredient.item_class)
    used_items[ingredient.item_class] = {
        "className": ingredient.item_class,
        "name": ingredient.item_name,
        "unit": ingredient.unit,
        "form": "" if info is None else info.form,
        "isRawResource": False if info is None else "FGResourceDescriptor" in info.native_class,
    }


def planner_ingredient_to_dict(item: Ingredient) -> dict[str, Any]:
    return {
        "itemClass": item.item_class,
        "itemName": item.item_name,
        "amount": clean_number(item.amount),
        "unit": item.unit,
        "perMin": clean_number(item.per_min),
    }


def ingredient_to_dict(item: Ingredient) -> dict[str, Any]:
    return {
        "item_class": item.item_class,
        "item_name": item.item_name,
        "raw_amount": item.raw_amount,
        "amount": item.amount,
        "unit": item.unit,
        "per_min": item.per_min,
    }


def write_xlsx(path: Path, sheets: Sequence[tuple[str, list[list[Any]]]]) -> None:
    if not sheets:
        raise ExportError("no sheets to write")

    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", content_types_xml(len(sheets)))
        workbook.writestr("_rels/.rels", package_rels_xml())
        workbook.writestr("docProps/core.xml", core_props_xml())
        workbook.writestr("docProps/app.xml", app_props_xml([name for name, _rows in sheets]))
        workbook.writestr("xl/workbook.xml", workbook_xml([name for name, _rows in sheets]))
        workbook.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml(len(sheets)))
        for index, (_name, rows) in enumerate(sheets, start=1):
            workbook.writestr(f"xl/worksheets/sheet{index}.xml", worksheet_xml(rows))


def content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    for index in range(1, sheet_count + 1):
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + "".join(overrides)
        + "</Types>"
    )


def package_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )


def core_props_xml() -> str:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dc:creator>satisfactory_recipes_export.py</dc:creator>"
        "<cp:lastModifiedBy>satisfactory_recipes_export.py</cp:lastModifiedBy>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>'
        "</cp:coreProperties>"
    )


def app_props_xml(sheet_names: Sequence[str]) -> str:
    titles = "".join(f"<vt:lpstr>{xml_text(name)}</vt:lpstr>" for name in sheet_names)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>Python</Application>"
        f"<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs>"
        '<vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>'
        f"<vt:variant><vt:i4>{len(sheet_names)}</vt:i4></vt:variant></vt:vector></HeadingPairs>"
        f'<TitlesOfParts><vt:vector size="{len(sheet_names)}" baseType="lpstr">{titles}</vt:vector></TitlesOfParts>'
        "</Properties>"
    )


def workbook_xml(sheet_names: Sequence[str]) -> str:
    sheets_xml = "".join(
        f'<sheet name="{xml_attr(safe_sheet_name(name))}" sheetId="{index}" r:id="rId{index}"/>'
        for index, name in enumerate(sheet_names, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{sheets_xml}</sheets>"
        "</workbook>"
    )


def workbook_rels_xml(sheet_count: int) -> str:
    relationships = "".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + relationships
        + "</Relationships>"
    )


def worksheet_xml(rows: Sequence[Sequence[Any]]) -> str:
    row_count = len(rows)
    col_count = max((len(row) for row in rows), default=1)
    dimension = f"A1:{column_name(col_count)}{max(row_count, 1)}"
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
        f'<dimension ref="{dimension}"/>',
        '<sheetViews><sheetView workbookViewId="0">',
    ]
    if row_count > 1:
        parts.append('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
        parts.append('<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>')
    parts.append("</sheetView></sheetViews>")
    parts.append(cols_xml(rows, col_count))
    parts.append("<sheetData>")
    for row_index, row in enumerate(rows, start=1):
        parts.append(f'<row r="{row_index}">')
        for col_index, value in enumerate(row, start=1):
            if value is None:
                continue
            parts.append(cell_xml(row_index, col_index, value))
        parts.append("</row>")
    parts.append("</sheetData>")
    if row_count > 1 and col_count > 0:
        parts.append(f'<autoFilter ref="A1:{column_name(col_count)}{row_count}"/>')
    parts.append("</worksheet>")
    return "".join(parts)


def cols_xml(rows: Sequence[Sequence[Any]], col_count: int) -> str:
    if not rows:
        return ""
    widths = []
    sample = rows[:200]
    for col_index in range(col_count):
        max_len = 8
        for row in sample:
            if col_index < len(row):
                max_len = max(max_len, min(len(str(row[col_index])), 60))
        widths.append(max(8, min(max_len + 2, 64)))
    return "<cols>" + "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        for index, width in enumerate(widths, start=1)
    ) + "</cols>"


def cell_xml(row_index: int, col_index: int, value: Any) -> str:
    ref = f"{column_name(col_index)}{row_index}"
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return f'<c r="{ref}" t="inlineStr"><is><t></t></is></c>'
        return f'<c r="{ref}"><v>{format_number(value)}</v></c>'
    text = xml_text(str(value))
    preserve = ' xml:space="preserve"' if text.strip() != text else ""
    return f'<c r="{ref}" t="inlineStr"><is><t{preserve}>{text}</t></is></c>'


def column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name or "A"


def safe_sheet_name(name: str) -> str:
    cleaned = re.sub(r"[\[\]:*?/\\]", "_", name).strip("'")
    return (cleaned or "Sheet")[:31]


def xml_text(value: str) -> str:
    return escape(INVALID_XML_CHARS_RE.sub("", value), {'"': "&quot;"})


def xml_attr(value: str) -> str:
    return xml_text(value)


def class_name_from_path(path: str) -> str:
    cleaned = path.strip().strip('"').strip("'")
    if "." in cleaned:
        return cleaned.rsplit(".", 1)[-1]
    return cleaned.rsplit("/", 1)[-1]


def extract_class_refs(value: Any) -> list[str]:
    text = string_value(value)
    refs = [class_name_from_path(match.group("path")) for match in CLASS_PATH_RE.finditer(text)]
    seen: set[str] = set()
    result: list[str] = []
    for ref in refs:
        if ref and ref not in seen:
            seen.add(ref)
            result.append(ref)
    return result


def is_alternate_recipe(class_name: str, recipe_name: str) -> bool:
    combined = f"{class_name} {recipe_name}".lower()
    return "alternate" in combined or "alt_" in combined or "_alt" in combined


def unit_for_form(form: str) -> str:
    normalized = form.lower()
    if "liquid" in normalized or "gas" in normalized:
        return "m3"
    return "items"


def normalized_amount(raw_amount: float, unit: str) -> float:
    if unit == "m3":
        return raw_amount / 1000.0
    return raw_amount


def string_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def float_value(value: Any) -> float:
    text = string_value(value)
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def clean_number(value: float) -> float | int:
    if isinstance(value, bool):
        return value
    if abs(value - round(value)) < 1e-9:
        return int(round(value))
    return round(value, 6)


def format_number(value: float | int) -> str:
    if isinstance(value, int):
        return str(value)
    if abs(value - round(value)) < 1e-9:
        return str(int(round(value)))
    return f"{value:.6f}".rstrip("0").rstrip(".")


def humanize_class_name(class_name: str) -> str:
    name = class_name
    for prefix in ("Desc_", "Recipe_", "Build_", "BP_", "FG"):
        if name.startswith(prefix):
            name = name[len(prefix) :]
    if name.endswith("_C"):
        name = name[:-2]
    name = name.replace("_", " ")
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    return name.strip() or class_name


if __name__ == "__main__":
    raise SystemExit(main())
