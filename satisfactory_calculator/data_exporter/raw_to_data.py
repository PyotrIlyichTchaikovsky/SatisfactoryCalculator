#!/usr/bin/env python3
"""Build planner Data.xlsx from RawData.json using a declarative config."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
CONFIG_FILE_NAME = "raw_to_data.config.json"
DEFAULT_ALLOWED_RECIPE_PRODUCED_IN_NATIVE_CLASSES = (
    "FGBuildableManufacturer",
    "FGBuildableManufacturerVariablePower",
)
DEFAULT_POWER_RECIPE_NATIVE_CLASSES = (
    "FGBuildableGeneratorFuel",
    "FGBuildableGeneratorNuclear",
    "FGBuildableGeneratorGeoThermal",
)
UNLOCK_RECIPE_CLASS_RE = re.compile(r"\.([A-Za-z0-9_]+_C)'")

sys.path.insert(0, str(PROJECT_ROOT))
from satisfactory_calculator.data_exporter import game_rawdata_exporter as raw  # noqa: E402


class ConfigError(ValueError):
    pass


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        config_path = args.config.expanduser().resolve()
        config = load_config(config_path)
        raw_json_path = required_config_path(config, config_path, "source", "raw_json")
        data_xlsx_path = required_config_path(config, config_path, "output", "data_xlsx")
        build_data(config, config_path, raw_json_path, data_xlsx_path)
        print(f"Wrote planner data: {data_xlsx_path}")
        print(f"Source raw JSON: {raw_json_path}")
        print(f"Config: {config_path}")
        return 0
    except (ConfigError, raw.ExportError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build planner Data.xlsx from RawData.json.")
    parser.add_argument(
        "--config",
        type=Path,
        default=SCRIPT_DIR / CONFIG_FILE_NAME,
        help="Path to raw_to_data.config.json.",
    )
    return parser.parse_args(argv)


def load_config(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            config = json.load(handle)
    except FileNotFoundError as exc:
        raise ConfigError(f"config file does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"config file is not valid JSON: {path}: {exc}") from exc
    if not isinstance(config, dict):
        raise ConfigError(f"config file must contain a JSON object: {path}")
    return config


def required_config_path(config: dict[str, Any], config_path: Path, section: str, key: str) -> Path:
    section_value = config.get(section)
    if not isinstance(section_value, dict):
        raise ConfigError(f"config section {section!r} must be an object")
    value = section_value.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"config key {section}.{key} must be a non-empty path string")
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return (config_path.parent / path).resolve()


def build_data(config: dict[str, Any], config_path: Path, raw_json_path: Path, data_xlsx_path: Path) -> None:
    rules = planner_rules(config)
    if rules.get("generate_power_recipes", True) and not rules.get("generate_power_items", True):
        raise ConfigError("planner_rules.generate_power_recipes requires generate_power_items")

    data = raw.load_json(raw_json_path)
    all_classes = list(raw.iter_docs_classes(data))
    classes = filter_native_classes(all_classes, enabled_native_classes(config))
    if not classes:
        raise ConfigError("no NativeClass data matched raw_to_data.config.json")

    display_names = raw.build_display_name_index(classes)
    devices = raw.build_device_index(classes, display_names)
    items = raw.build_item_index(classes, display_names)
    if rules.get("generate_power_items", True):
        raw.add_power_items(items)

    class_native_names = class_native_name_index(classes)
    mam_recipe_ids = recipe_ids_unlocked_by_mam(classes)
    recipes = raw.build_recipes(classes, display_names, items, raw_json_path)
    mark_mam_recipes_as_base(recipes, mam_recipe_ids)
    recipes = keep_recipes_with_allowed_produced_in_classes(
        recipes,
        class_native_names,
        string_list_rule(
            rules,
            "allowed_recipe_produced_in_native_classes",
            DEFAULT_ALLOWED_RECIPE_PRODUCED_IN_NATIVE_CLASSES,
        ),
    )
    if rules.get("generate_power_recipes", True):
        power_classes = filter_native_classes(
            classes,
            set(
                string_list_rule(
                    rules,
                    "power_recipe_native_classes",
                    DEFAULT_POWER_RECIPE_NATIVE_CLASSES,
                )
            ),
        )
        recipes.extend(raw.build_power_recipes(power_classes, display_names, items, raw_json_path))
    recipes.sort(key=lambda recipe: (", ".join(recipe.produced_in).lower(), recipe.recipe_name.lower(), recipe.is_alternate))

    workbook_args = build_args(config_path, raw_json_path, data_xlsx_path)
    raw.ensure_icon_directories(data_xlsx_path)
    sheets = raw.build_sheets(recipes, items, devices, raw_json_path, workbook_args)
    sheets.extend(build_recipe_requirement_sheets(config, data_xlsx_path, sheets))
    sheets = filter_sheets(sheets, config.get("sheets", {}))
    raw.write_xlsx(data_xlsx_path, sheets)


def planner_rules(config: dict[str, Any]) -> dict[str, Any]:
    rules = config.get("planner_rules", {})
    if rules is None:
        return {}
    if not isinstance(rules, dict):
        raise ConfigError("planner_rules must be an object")
    return rules


def string_list_rule(rules: dict[str, Any], key: str, default: Sequence[str]) -> list[str]:
    value = rules.get(key, list(default))
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ConfigError(f"planner_rules.{key} must be an array of strings")
    result = [item.strip() for item in value if item.strip()]
    if not result:
        raise ConfigError(f"planner_rules.{key} must contain at least one NativeClass name")
    return result


def enabled_native_classes(config: dict[str, Any]) -> set[str]:
    section = config.get("native_classes")
    if not isinstance(section, dict):
        raise ConfigError("native_classes must be an object")
    enabled: set[str] = set()
    for group_name, values in section.items():
        if group_name.startswith("_"):
            continue
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            raise ConfigError(f"native_classes.{group_name} must be an array of strings")
        enabled.update(value.strip() for value in values if value.strip())
    if not enabled:
        raise ConfigError("native_classes must enable at least one NativeClass")
    return enabled


def filter_native_classes(
    classes: Sequence[tuple[str, dict[str, Any]]],
    enabled_short_names: set[str],
) -> list[tuple[str, dict[str, Any]]]:
    return [
        (native_class, obj)
        for native_class, obj in classes
        if short_native_name(native_class) in enabled_short_names
    ]


def short_native_name(native_class: str) -> str:
    return native_class.rsplit(".", 1)[-1].strip("'") if native_class else ""


def class_native_name_index(classes: Sequence[tuple[str, dict[str, Any]]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for native_class, obj in classes:
        class_name = raw.string_value(obj.get("ClassName"))
        if class_name:
            result[class_name] = short_native_name(native_class)
    return result


def recipe_ids_unlocked_by_mam(classes: Sequence[tuple[str, dict[str, Any]]]) -> set[str]:
    recipe_ids: set[str] = set()
    for native_class, obj in classes:
        if short_native_name(native_class) != "FGSchematic":
            continue
        if raw.string_value(obj.get("mType")) != "EST_MAM":
            continue
        unlocks = obj.get("mUnlocks")
        if not isinstance(unlocks, list):
            continue
        for unlock in unlocks:
            if not isinstance(unlock, dict) or raw.string_value(unlock.get("Class")) != "BP_UnlockRecipe_C":
                continue
            recipe_ids.update(unlock_recipe_class_refs(unlock.get("mRecipes")))
    return recipe_ids


def unlock_recipe_class_refs(value: Any) -> set[str]:
    return set(UNLOCK_RECIPE_CLASS_RE.findall(raw.string_value(value)))


def mark_mam_recipes_as_base(recipes: Sequence[raw.Recipe], mam_recipe_ids: set[str]) -> None:
    for recipe in recipes:
        if recipe.recipe_id in mam_recipe_ids:
            recipe.is_alternate = False


def keep_recipes_with_allowed_produced_in_classes(
    recipes: Sequence[raw.Recipe],
    class_native_names: dict[str, str],
    allowed_native_classes: Sequence[str],
) -> list[raw.Recipe]:
    allowed = set(allowed_native_classes)
    result: list[raw.Recipe] = []
    for recipe in recipes:
        kept_indexes = [
            index
            for index, device_class in enumerate(recipe.produced_in_classes)
            if class_native_names.get(device_class) in allowed
        ]
        if not kept_indexes:
            continue
        result.append(
            replace(
                recipe,
                produced_in=[recipe.produced_in[index] for index in kept_indexes if index < len(recipe.produced_in)],
                produced_in_classes=[recipe.produced_in_classes[index] for index in kept_indexes],
            )
        )
    return result


def build_args(config_path: Path, raw_json_path: Path, data_xlsx_path: Path) -> SimpleNamespace:
    return SimpleNamespace(
        config=config_path,
        game_dir=None,
        docs_json=raw_json_path,
        auto=False,
        raw_json_out=raw_json_path,
        raw_out="",
        data_out=data_xlsx_path,
        lang="",
        wide_only=False,
        debug_json=False,
    )


def filter_sheets(sheets: Sequence[raw.Worksheet], sheet_config: Any) -> list[raw.Worksheet]:
    if sheet_config is None:
        return list(sheets)
    if not isinstance(sheet_config, dict):
        raise ConfigError("sheets must be an object")
    enabled = {
        str(name)
        for name, value in sheet_config.items()
        if not str(name).startswith("_") and bool(value)
    }
    if not enabled:
        raise ConfigError("sheets must enable at least one worksheet")
    return [sheet for sheet in sheets if sheet.name in enabled]


def build_recipe_requirement_sheets(
    config: dict[str, Any],
    data_xlsx_path: Path,
    base_sheets: Sequence[raw.Worksheet],
) -> list[raw.Worksheet]:
    sheet_config = config.get("sheets", {})
    if not isinstance(sheet_config, dict):
        return []
    wanted = {
        sheet_name
        for sheet_name in ("BaseRecipeRequirements", "AllRecipeRequirements")
        if bool(sheet_config.get(sheet_name))
    }
    if not wanted:
        return []

    from satisfactory_calculator.recipe_web.production_planner_core import PlannerError, ProductionPlanner

    temp_path = data_xlsx_path.with_name(f".{data_xlsx_path.stem}.requirements.tmp.xlsx")
    raw.write_xlsx(temp_path, base_sheets)
    try:
        planner = ProductionPlanner.from_excel(temp_path)
        result: list[raw.Worksheet] = []
        if "BaseRecipeRequirements" in wanted:
            result.append(
                raw.Worksheet(
                    "BaseRecipeRequirements",
                    build_recipe_requirement_rows(
                        planner,
                        sorted(planner.default_enabled_recipe_ids),
                        "Base",
                        PlannerError,
                    ),
                )
            )
        if "AllRecipeRequirements" in wanted:
            result.append(
                raw.Worksheet(
                    "AllRecipeRequirements",
                    build_recipe_requirement_rows(
                        planner,
                        sorted(planner.selectable_recipe_ids),
                        "All",
                        PlannerError,
                    ),
                )
            )
        return result
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


def build_recipe_requirement_rows(
    planner: Any,
    enabled_recipe_ids: Sequence[str],
    mode: str,
    planner_error_type: type[Exception],
) -> list[list[Any]]:
    rows: list[list[Any]] = [
        [
            "TargetClassName",
            "TargetName",
            "TargetUnit",
            "TargetRate",
            "RecipeMode",
            "Status",
            "RecipeID",
            "RecipeName",
            "RecipeScale",
            "RecipeOutput",
            "Failure",
        ]
    ]
    active_recipe_ids = set(enabled_recipe_ids)

    for item in planner.items_list:
        try:
            parsed_targets = planner._parse_targets([{"itemClass": item.class_name, "rate": 1.0}])
            solution = planner._solve_linear_plan(parsed_targets, active_recipe_ids, set())
        except planner_error_type as exc:
            rows.append(
                [
                    item.class_name,
                    item.name,
                    item.unit,
                    1,
                    mode,
                    "Infeasible",
                    "",
                    "",
                    "",
                    "",
                    str(exc),
                ]
            )
            continue

        recipe_runs = solution.get("recipeRuns", [])
        if recipe_runs:
            for run in recipe_runs:
                rows.append(
                    [
                        item.class_name,
                        item.name,
                        item.unit,
                        1,
                        mode,
                        "OK",
                        run.get("id", ""),
                        run.get("recipe", {}).get("name", ""),
                        raw.clean_number(float(run.get("scale") or 0.0)),
                        requirement_output_text(run.get("outputs", [])),
                        "",
                    ]
                )
            continue

        raw_totals = solution.get("rawTotals", [])
        if raw_totals:
            for raw_total in raw_totals:
                rows.append(
                    [
                        item.class_name,
                        item.name,
                        item.unit,
                        1,
                        mode,
                        "ExternalInput",
                        "",
                        "External Input",
                        raw.clean_number(float(raw_total.get("rate") or 0.0)),
                        raw_total.get("item", {}).get("name", ""),
                        "",
                    ]
                )
            continue

        rows.append(
            [
                item.class_name,
                item.name,
                item.unit,
                1,
                mode,
                "NoRecipe",
                "",
                "",
                "",
                "",
                "",
            ]
        )

    return rows


def requirement_output_text(outputs: Sequence[dict[str, Any]]) -> str:
    parts: list[str] = []
    for output in outputs:
        item = output.get("item", {})
        name = item.get("name") or item.get("className") or ""
        rate = output.get("rate", 0)
        unit = output.get("unit") or item.get("unit") or ""
        parts.append(f"{name} {rate} {unit}/min".strip())
    return " + ".join(parts)


if __name__ == "__main__":
    raise SystemExit(main())
