#!/usr/bin/env python3
"""Export Satisfactory Docs.json recipes to a wide Excel workbook.

The script reads real Docs.json recipes, excludes extraction rules, and adds
generator-derived virtual power recipes so power and generator byproducts can
participate in planning.
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


SCRIPT_VERSION = "0.3.3"
CONFIG_FILE_NAME = "satisfactory_recipes_export.config.json"
EXCEL_FILE_NAME = "Satisfactory_Recipes_Wide.xlsx"
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
RAW_DATA_DIR = PROJECT_ROOT / "raw_data"

RECIPE_NATIVE_CLASS = "FGRecipe"
ITEM_AMOUNT_RE = re.compile(
    r"ItemClass\s*=\s*\"?[^']*'(?P<path>[^']+)'\"?\s*,\s*Amount\s*=\s*(?P<amount>[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)",
    re.IGNORECASE,
)
CLASS_PATH_RE = re.compile(r"'(?P<path>/[^']+)'")
INVALID_XML_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
SYNTHETIC_POWER_NATIVE_CLASS = "SyntheticPowerItem"
SYNTHETIC_POWER_SOURCE_CLASS = "SyntheticGeneratorPowerRecipe"
STYLE_DEFAULT = 0
STYLE_INPUT = 1
STYLE_OUTPUT = 2
POWER_OUTPUT_BY_GENERATOR = {
    "Build_GeneratorBiomass_Automated_C": ("Desc_Power_Biomass_C", "Biomass Power"),
    "Build_GeneratorCoal_C": ("Desc_Power_Coal_C", "Coal Power"),
    "Build_GeneratorFuel_C": ("Desc_Power_Fuel_C", "Fuel Power"),
    "Build_GeneratorNuclear_C": ("Desc_Power_Nuclear_C", "Nuclear Power"),
    "Build_GeneratorGeoThermal_C": ("Desc_Power_Geothermal_C", "Geothermal Power"),
}
SUPPLEMENTAL_RATE_PER_MIN = {
    ("Build_GeneratorCoal_C", "Desc_Water_C"): 45.0,
    ("Build_GeneratorNuclear_C", "Desc_Water_C"): 240.0,
}
NUCLEAR_FUEL_REPLACEMENT_ORDER = {
    "Desc_NuclearFuelRod_C": 0,
    "Desc_PlutoniumFuelRod_C": 1,
    "Desc_FicsoniumFuelRod_C": 2,
}
RAW_REASON_RESOURCE_DESCRIPTOR = "游戏资源描述符（NativeClass 包含 FGResourceDescriptor）"
RAW_REASON_NO_RECIPE_OUTPUT = "没有非采集配方产出（RecipeOutputs 中不存在该物品）"


@dataclass(frozen=True)
class ItemInfo:
    class_name: str
    display_name: str
    form: str = ""
    unit: str = "items"
    stack_size: str = ""
    sink_points: str = ""
    native_class: str = ""
    energy_value: float = 0.0


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


@dataclass(frozen=True)
class MergeRange:
    start_row: int
    start_col: int
    end_row: int
    end_col: int


@dataclass(frozen=True)
class StyledCell:
    value: Any
    style: int = STYLE_DEFAULT


@dataclass
class Worksheet:
    name: str
    rows: list[list[Any]]
    merges: list[MergeRange] = field(default_factory=list)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        docs_path = resolve_docs_path(args)
        data = load_json(docs_path)
        classes = list(iter_docs_classes(data))
        display_names = build_display_name_index(classes)
        items = build_item_index(classes, display_names)
        add_power_items(items)
        recipes = build_recipes(classes, display_names, items, docs_path)
        recipes = filter_recipes(recipes, args)
        recipes.extend(build_power_recipes(classes, display_names, items, docs_path))
        recipes.sort(key=lambda recipe: (", ".join(recipe.produced_in).lower(), recipe.recipe_name.lower(), recipe.is_alternate))

        sheets = build_sheets(recipes, items, docs_path, args)
        write_xlsx(args.out, sheets)

        if args.debug_json:
            write_debug_json(args.out, recipes, items, docs_path)

        print(f"Wrote {args.out}")
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
            energy_value=float_value(obj.get("mEnergyValue")),
        )
        items[class_name] = info
        if class_name.endswith("_C"):
            items[class_name[:-2]] = info
    return items


def add_power_items(items: dict[str, ItemInfo]) -> None:
    for item_class, display_name in dict(POWER_OUTPUT_BY_GENERATOR.values()).items():
        if item_class in items:
            continue
        info = ItemInfo(
            class_name=item_class,
            display_name=display_name,
            form="RF_POWER",
            unit="MW",
            native_class=SYNTHETIC_POWER_NATIVE_CLASS,
        )
        items[item_class] = info
        if item_class.endswith("_C"):
            items[item_class[:-2]] = info


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


def build_power_recipes(
    classes: Sequence[tuple[str, dict[str, Any]]],
    display_names: dict[str, str],
    items: dict[str, ItemInfo],
    docs_path: Path,
) -> list[Recipe]:
    recipes: list[Recipe] = []
    source_file = f"{docs_path}#generator-power"

    for native_class, obj in classes:
        generator_class = string_value(obj.get("ClassName"))
        power_definition = POWER_OUTPUT_BY_GENERATOR.get(generator_class)
        if not power_definition:
            continue

        power_class, _power_name = power_definition
        power_item = item_info_for_class(power_class, items)
        if power_item is None:
            continue

        generator_name = display_names.get(generator_class) or string_value(obj.get("mDisplayName")) or humanize_class_name(generator_class)
        power_rate = generator_power_rate(generator_class, obj)
        if power_rate <= 0:
            continue

        if generator_class == "Build_GeneratorGeoThermal_C":
            recipes.append(
                Recipe(
                    recipe_id=f"Recipe_Power_{generator_class}",
                    recipe_name=f"Power: {generator_name}",
                    is_alternate=False,
                    produced_in=[generator_name],
                    produced_in_classes=[generator_class],
                    duration_sec=60.0,
                    outputs=[ingredient_with_rate(power_class, power_item, power_rate)],
                    source_class=SYNTHETIC_POWER_SOURCE_CLASS,
                    source_file=source_file,
                )
            )
            continue

        fuel_entries = obj.get("mFuel")
        if not isinstance(fuel_entries, list):
            continue

        seen_fuels: set[str] = set()
        for fuel_entry in fuel_entries:
            if not isinstance(fuel_entry, dict):
                continue
            fuel_class = clean_class_ref(fuel_entry.get("mFuelClass"))
            if not fuel_class or fuel_class in seen_fuels:
                continue
            seen_fuels.add(fuel_class)

            recipe = build_fueled_power_recipe(
                native_class=native_class,
                generator_class=generator_class,
                generator_name=generator_name,
                generator_obj=obj,
                fuel_entry=fuel_entry,
                fuel_class=fuel_class,
                power_class=power_class,
                power_item=power_item,
                power_rate=power_rate,
                items=items,
                source_file=source_file,
            )
            if recipe is not None:
                recipes.append(recipe)

    return recipes


def build_fueled_power_recipe(
    native_class: str,
    generator_class: str,
    generator_name: str,
    generator_obj: dict[str, Any],
    fuel_entry: dict[str, Any],
    fuel_class: str,
    power_class: str,
    power_item: ItemInfo,
    power_rate: float,
    items: dict[str, ItemInfo],
    source_file: str,
) -> Recipe | None:
    fuel_item = item_info_for_class(fuel_class, items)
    if fuel_item is None or fuel_item.energy_value <= 0:
        return None

    fuel_raw_per_min = 60.0 * power_rate / fuel_item.energy_value
    fuel_per_min = normalized_amount(fuel_raw_per_min, fuel_item.unit)
    if fuel_per_min <= 0:
        return None

    inputs = [ingredient_with_rate(fuel_class, fuel_item, fuel_per_min)]

    supplemental_class = clean_class_ref(fuel_entry.get("mSupplementalResourceClass"))
    if supplemental_class:
        supplemental_item = item_info_for_class(supplemental_class, items)
        supplemental_rate = SUPPLEMENTAL_RATE_PER_MIN.get((generator_class, supplemental_class), 0.0)
        if supplemental_item is not None and supplemental_rate > 0:
            inputs.append(ingredient_with_rate(supplemental_class, supplemental_item, supplemental_rate))

    outputs = [ingredient_with_rate(power_class, power_item, power_rate)]
    byproduct = byproduct_ingredient(generator_obj, fuel_entry, fuel_item, fuel_per_min, items)
    if byproduct is not None:
        outputs.append(byproduct)

    return Recipe(
        recipe_id=f"Recipe_Power_{generator_class}_{fuel_class}",
        recipe_name=f"Power: {generator_name} ({fuel_item.display_name})",
        is_alternate=False,
        produced_in=[generator_name],
        produced_in_classes=[generator_class],
        duration_sec=60.0,
        inputs=inputs,
        outputs=outputs,
        source_class=native_class,
        source_file=source_file,
    )


def byproduct_ingredient(
    generator_obj: dict[str, Any],
    fuel_entry: dict[str, Any],
    fuel_item: ItemInfo,
    fuel_per_min: float,
    items: dict[str, ItemInfo],
) -> Ingredient | None:
    byproduct_class = clean_class_ref(fuel_entry.get("mByproduct"))
    byproduct_raw_amount = float_value(fuel_entry.get("mByproductAmount"))
    byproduct_item = item_info_for_class(byproduct_class, items) if byproduct_class else None
    if not byproduct_class or byproduct_item is None or byproduct_raw_amount <= 0:
        return None

    fuel_load_raw = float_value(generator_obj.get("mFuelLoadAmount")) or 1.0
    fuel_load_amount = normalized_amount(fuel_load_raw, fuel_item.unit)
    if fuel_load_amount <= 0:
        return None

    fuel_loads_per_min = fuel_per_min / fuel_load_amount
    byproduct_amount = normalized_amount(byproduct_raw_amount, byproduct_item.unit)
    byproduct_per_min = byproduct_amount * fuel_loads_per_min
    if byproduct_per_min <= 0:
        return None
    return ingredient_with_rate(byproduct_class, byproduct_item, byproduct_per_min)


def generator_power_rate(generator_class: str, obj: dict[str, Any]) -> float:
    fixed_power = float_value(obj.get("mPowerProduction"))
    if fixed_power > 0:
        return fixed_power
    if generator_class == "Build_GeneratorGeoThermal_C":
        return float_value(obj.get("mVariablePowerProductionFactor"))
    return 0.0


def ingredient_with_rate(item_class: str, item: ItemInfo, per_min: float) -> Ingredient:
    return Ingredient(
        item_class=item_class,
        item_name=item.display_name,
        raw_amount=denormalized_amount(per_min, item.unit),
        amount=per_min,
        unit=item.unit,
        per_min=per_min,
    )


def clean_class_ref(value: Any) -> str:
    text = string_value(value)
    if not text or text.lower() == "none":
        return ""
    if "/" in text or "." in text:
        return class_name_from_path(text)
    return text


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
) -> list[Worksheet]:
    wide_rows = build_recipes_wide_rows(recipes)
    if args.wide_only:
        return [Worksheet("RecipesWide", wide_rows)]

    unique_items = sorted(
        {info.class_name: info for info in items.values()}.values(),
        key=lambda item: item.display_name.lower(),
    )
    sheets = [
        Worksheet("README", build_readme_rows(recipes, items, docs_path, args)),
        Worksheet("RecipesWide", wide_rows),
        Worksheet("RecipeSummary", build_recipe_summary_rows(recipes)),
        build_replacement_group_sheet(recipes),
        Worksheet("Items", build_items_rows(unique_items)),
        Worksheet("RawMaterials", build_raw_material_rows(recipes, items)),
        Worksheet("RecipesLong", build_recipes_long_rows(recipes)),
        Worksheet("RecipeInputs", build_recipe_io_rows(recipes, input_side=True)),
        Worksheet("RecipeOutputs", build_recipe_io_rows(recipes, input_side=False)),
        Worksheet("VersionInfo", build_version_rows(docs_path, args)),
        Worksheet("Validation", build_validation_rows(recipes, unique_items)),
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


def build_recipe_summary_rows(recipes: Sequence[Recipe]) -> list[list[Any]]:
    rows = [["配方名字", "输入材料", "输出材料"]]
    for recipe in recipes:
        rows.append(
            [
                recipe.recipe_name,
                format_summary_io_text(recipe.inputs),
                format_summary_io_text(recipe.outputs),
            ]
        )
    return rows


def build_replacement_group_sheet(recipes: Sequence[Recipe]) -> Worksheet:
    merges: list[MergeRange] = []
    groups: dict[str, list[Recipe]] = {}

    for recipe in recipes:
        primary_output = primary_output_class(recipe)
        if not primary_output:
            continue
        groups.setdefault(primary_output, []).append(recipe)

    grouped_recipes = [
        sorted(group, key=replacement_group_recipe_sort_key)
        for group in groups.values()
        if len(group) > 1
    ]
    grouped_recipes.sort(key=lambda group: (group[0].outputs[0].item_name.lower(), group[0].outputs[0].item_class))

    grouped_recipe_values = [recipe for group in grouped_recipes for recipe in group]
    max_inputs = max((len(recipe.inputs) for recipe in grouped_recipe_values), default=0)
    max_outputs = max((len(recipe.outputs) for recipe in grouped_recipe_values), default=0)
    rows: list[list[Any]] = [
        [
            "产出材料名称",
            "配方名称",
            *[StyledCell(f"消耗{index}", STYLE_INPUT) for index in range(1, max_inputs + 1)],
            *[StyledCell(f"产出{index}", STYLE_OUTPUT) for index in range(1, max_outputs + 1)],
        ]
    ]

    for group in grouped_recipes:
        start_row = len(rows) + 1
        output_name = group[0].outputs[0].item_name
        for index, recipe in enumerate(group):
            row: list[Any] = [
                output_name if index == 0 else None,
                recipe.recipe_name,
            ]
            for input_index in range(max_inputs):
                row.append(
                    StyledCell(ingredient_cell_text(recipe.inputs[input_index]), STYLE_INPUT)
                    if input_index < len(recipe.inputs)
                    else StyledCell("", STYLE_INPUT)
                )
            for output_index in range(max_outputs):
                row.append(
                    StyledCell(ingredient_cell_text(recipe.outputs[output_index]), STYLE_OUTPUT)
                    if output_index < len(recipe.outputs)
                    else StyledCell("", STYLE_OUTPUT)
                )
            rows.append(
                row
            )
        end_row = len(rows)
        if end_row > start_row:
            merges.append(MergeRange(start_row, 1, end_row, 1))

    return Worksheet("ReplacementGroup", rows, merges)


def replacement_group_recipe_sort_key(recipe: Recipe) -> tuple[int, int, str, str]:
    return (
        1 if recipe.is_alternate else 0,
        nuclear_fuel_replacement_rank(recipe),
        recipe.recipe_name.lower(),
        recipe.recipe_id,
    )


def nuclear_fuel_replacement_rank(recipe: Recipe) -> int:
    prefix = "Recipe_Power_Build_GeneratorNuclear_C_"
    if not recipe.recipe_id.startswith(prefix):
        return 999
    fuel_class = recipe.recipe_id.removeprefix(prefix)
    return NUCLEAR_FUEL_REPLACEMENT_ORDER.get(fuel_class, 999)


def primary_output_class(recipe: Recipe) -> str:
    if not recipe.outputs:
        return ""
    return recipe.outputs[0].item_class


def format_recipe_formula(recipe: Recipe) -> str:
    return f"{format_formula_side(recipe.inputs)} = {format_formula_side(recipe.outputs)}"


def format_formula_side(items: Sequence[Ingredient]) -> str:
    if not items:
        return "无"
    return " + ".join(ingredient_cell_text(item) for item in items)


def ingredient_cell_text(item: Ingredient) -> str:
    return f"{item.item_name}（{format_number(clean_number(item.per_min))}）"


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
        ["GeneratedPowerRecipes", "Generator fuel rules are converted into virtual power recipes; extraction rules remain excluded."],
        ["RecipeCount", len(recipes)],
        ["KnownItemCount", len({item.class_name for item in items.values()})],
        ["SourceDocsJson", str(docs_path)],
    ]


def build_items_rows(items: Sequence[ItemInfo]) -> list[list[Any]]:
    rows = [["ClassName", "DisplayName", "Form", "Unit", "StackSize", "ResourceSinkPoints", "NativeClass", "EnergyValue"]]
    for item in items:
        rows.append(
            [
                item.class_name,
                item.display_name,
                item.form,
                item.unit,
                item.stack_size,
                item.sink_points,
                item.native_class,
                clean_number(item.energy_value),
            ]
        )
    return rows


def build_raw_material_rows(recipes: Sequence[Recipe], items: dict[str, ItemInfo]) -> list[list[Any]]:
    output_classes = {
        output.item_class
        for recipe in recipes
        for output in recipe.outputs
    }
    used_classes = {
        ingredient.item_class
        for recipe in recipes
        for ingredient in (*recipe.inputs, *recipe.outputs)
    }

    rows = [["ItemClass", "ItemName", "Reason"]]
    for item_class in sorted(used_classes, key=lambda value: (item_display_name(value, items).lower(), value)):
        item = item_info_for_class(item_class, items)
        reason = raw_material_reason(item_class, item, output_classes)
        if not reason:
            continue
        rows.append([item_class, item_display_name(item_class, items), reason])
    return rows


def raw_material_reason(item_class: str, item: ItemInfo | None, output_classes: set[str]) -> str:
    if item and "FGResourceDescriptor" in item.native_class:
        return RAW_REASON_RESOURCE_DESCRIPTOR
    if item_class not in output_classes:
        return RAW_REASON_NO_RECIPE_OUTPUT
    return ""


def item_info_for_class(item_class: str, items: dict[str, ItemInfo]) -> ItemInfo | None:
    return items.get(item_class) or items.get(item_class.removesuffix("_C"))


def item_display_name(item_class: str, items: dict[str, ItemInfo]) -> str:
    item = item_info_for_class(item_class, items)
    return item.display_name if item else humanize_class_name(item_class)


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
        ["GeneratedPowerRecipes", True],
        ["WideOnly", args.wide_only],
        ["DebugJson", args.debug_json],
    ]


def build_validation_rows(recipes: Sequence[Recipe], items: Sequence[ItemInfo]) -> list[list[Any]]:
    no_inputs = sum(1 for recipe in recipes if not recipe.inputs)
    no_producers = sum(1 for recipe in recipes if not recipe.produced_in)
    alternate = sum(1 for recipe in recipes if recipe.is_alternate)
    power_recipes = sum(1 for recipe in recipes if recipe.recipe_id.startswith("Recipe_Power_"))
    max_inputs = max((len(recipe.inputs) for recipe in recipes), default=0)
    max_outputs = max((len(recipe.outputs) for recipe in recipes), default=0)
    return [
        ["Metric", "Value"],
        ["RecipeCount", len(recipes)],
        ["ItemCount", len(items)],
        ["AlternateRecipeCount", alternate],
        ["PowerRecipeCount", power_recipes],
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


def format_summary_io_text(items: Sequence[Ingredient]) -> str:
    return "|".join(f"{item.item_name}（{format_number(clean_number(item.per_min))}）" for item in items)


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
                "energy_value": item.energy_value,
            }
            for item in {info.class_name: info for info in items.values()}.values()
        },
    }
    with debug_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def ingredient_to_dict(item: Ingredient) -> dict[str, Any]:
    return {
        "item_class": item.item_class,
        "item_name": item.item_name,
        "raw_amount": item.raw_amount,
        "amount": item.amount,
        "unit": item.unit,
        "per_min": item.per_min,
    }


def write_xlsx(path: Path, sheets: Sequence[Worksheet]) -> None:
    if not sheets:
        raise ExportError("no sheets to write")

    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", content_types_xml(len(sheets)))
        workbook.writestr("_rels/.rels", package_rels_xml())
        workbook.writestr("docProps/core.xml", core_props_xml())
        workbook.writestr("docProps/app.xml", app_props_xml([sheet.name for sheet in sheets]))
        workbook.writestr("xl/workbook.xml", workbook_xml([sheet.name for sheet in sheets]))
        workbook.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml(len(sheets)))
        workbook.writestr("xl/styles.xml", styles_xml())
        for index, sheet in enumerate(sheets, start=1):
            workbook.writestr(f"xl/worksheets/sheet{index}.xml", worksheet_xml(sheet.rows, sheet.merges))


def content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
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
    relationships = [
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, sheet_count + 1)
    ]
    relationships.append(
        f'<Relationship Id="rId{sheet_count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(relationships)
        + "</Relationships>"
    )


def styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>'
        '<fills count="4">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFE4E1"/><bgColor indexed="64"/></patternFill></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>'
        '</fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>'
        '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>'
        '</cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '<dxfs count="0"/>'
        '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
        '</styleSheet>'
    )


def worksheet_xml(rows: Sequence[Sequence[Any]], merges: Sequence[MergeRange] | None = None) -> str:
    merges = list(merges or [])
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
    if row_count > 1 and col_count > 0 and not merges:
        parts.append(f'<autoFilter ref="A1:{column_name(col_count)}{row_count}"/>')
    if merges:
        parts.append(f'<mergeCells count="{len(merges)}">')
        for merge in merges:
            parts.append(f'<mergeCell ref="{merge_range_ref(merge)}"/>')
        parts.append("</mergeCells>")
    parts.append("</worksheet>")
    return "".join(parts)


def merge_range_ref(merge: MergeRange) -> str:
    return (
        f"{column_name(merge.start_col)}{merge.start_row}:"
        f"{column_name(merge.end_col)}{merge.end_row}"
    )


def cols_xml(rows: Sequence[Sequence[Any]], col_count: int) -> str:
    if not rows:
        return ""
    widths = []
    sample = rows[:200]
    for col_index in range(col_count):
        max_len = 8
        for row in sample:
            if col_index < len(row):
                max_len = max(max_len, min(len(str(cell_display_value(row[col_index]))), 60))
        widths.append(max(8, min(max_len + 2, 64)))
    return "<cols>" + "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        for index, width in enumerate(widths, start=1)
    ) + "</cols>"


def cell_xml(row_index: int, col_index: int, value: Any) -> str:
    ref = f"{column_name(col_index)}{row_index}"
    style = STYLE_DEFAULT
    if isinstance(value, StyledCell):
        style = value.style
        value = value.value
    style_attr = f' s="{style}"' if style else ""
    if isinstance(value, bool):
        return f'<c r="{ref}"{style_attr} t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return f'<c r="{ref}"{style_attr} t="inlineStr"><is><t></t></is></c>'
        return f'<c r="{ref}"{style_attr}><v>{format_number(value)}</v></c>'
    text = xml_text(str(value))
    preserve = ' xml:space="preserve"' if text.strip() != text else ""
    return f'<c r="{ref}"{style_attr} t="inlineStr"><is><t{preserve}>{text}</t></is></c>'


def cell_display_value(value: Any) -> Any:
    if isinstance(value, StyledCell):
        return value.value
    return value


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


def denormalized_amount(amount: float, unit: str) -> float:
    if unit == "m3":
        return amount * 1000.0
    return amount


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
