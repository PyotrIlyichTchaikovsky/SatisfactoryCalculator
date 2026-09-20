from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "satisfactory_calculator" / "recipe_web"
OUTPUT_DIR = WEB_DIR / "i18n"
DEFAULT_GAME_DIR = Path(r"E:\Games\Steam\steamapps\common\Satisfactory")
DEFAULT_BUILD_ID = "24656030"

LOCALES = {
    "en-US": "en-US.json",
    "fr-FR": "fr.json",
    "it-IT": "it.json",
    "de-DE": "de.json",
    "es-ES": "es-ES.json",
    "ja-JP": "ja.json",
    "ko-KR": "ko.json",
    "pl-PL": "pl.json",
    "pt-BR": "pt-BR.json",
    "ru-RU": "ru.json",
    "zh-CN": "zh-Hans.json",
    "zh-TW": "zh-Hant.json",
    "uk-UA": "uk.json",
}

POWER_LABELS = {
    "en-US": {"Biomass": "Biomass Power", "Coal": "Coal Power", "Fuel": "Fuel Power", "Geothermal": "Geothermal Power", "Nuclear": "Nuclear Power"},
    "fr-FR": {"Biomass": "Énergie biomasse", "Coal": "Énergie au charbon", "Fuel": "Énergie au carburant", "Geothermal": "Énergie géothermique", "Nuclear": "Énergie nucléaire"},
    "it-IT": {"Biomass": "Energia da biomassa", "Coal": "Energia a carbone", "Fuel": "Energia a combustibile", "Geothermal": "Energia geotermica", "Nuclear": "Energia nucleare"},
    "de-DE": {"Biomass": "Biomassestrom", "Coal": "Kohlestrom", "Fuel": "Brennstoffstrom", "Geothermal": "Geothermie", "Nuclear": "Kernenergie"},
    "es-ES": {"Biomass": "Energía de biomasa", "Coal": "Energía de carbón", "Fuel": "Energía de combustible", "Geothermal": "Energía geotérmica", "Nuclear": "Energía nuclear"},
    "ja-JP": {"Biomass": "バイオマス発電", "Coal": "石炭発電", "Fuel": "燃料発電", "Geothermal": "地熱発電", "Nuclear": "原子力発電"},
    "ko-KR": {"Biomass": "바이오매스 발전", "Coal": "석탄 발전", "Fuel": "연료 발전", "Geothermal": "지열 발전", "Nuclear": "원자력 발전"},
    "pl-PL": {"Biomass": "Energia z biomasy", "Coal": "Energia z węgla", "Fuel": "Energia z paliwa", "Geothermal": "Energia geotermalna", "Nuclear": "Energia jądrowa"},
    "pt-BR": {"Biomass": "Energia de biomassa", "Coal": "Energia a carvão", "Fuel": "Energia a combustível", "Geothermal": "Energia geotérmica", "Nuclear": "Energia nuclear"},
    "ru-RU": {"Biomass": "Энергия из биомассы", "Coal": "Энергия из угля", "Fuel": "Энергия из топлива", "Geothermal": "Геотермальная энергия", "Nuclear": "Атомная энергия"},
    "zh-CN": {"Biomass": "生物质发电", "Coal": "煤电", "Fuel": "燃油发电", "Geothermal": "地热发电", "Nuclear": "核电"},
    "zh-TW": {"Biomass": "生質能發電", "Coal": "燃煤發電", "Fuel": "燃油發電", "Geothermal": "地熱發電", "Nuclear": "核能發電"},
    "uk-UA": {"Biomass": "Енергія з біомаси", "Coal": "Енергія з вугілля", "Fuel": "Енергія з палива", "Geothermal": "Геотермальна енергія", "Nuclear": "Атомна енергія"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate compact official Satisfactory name bundles.")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--build-id", default=DEFAULT_BUILD_ID)
    parser.add_argument("--verified-on", default=date.today().isoformat())
    return parser.parse_args()


def load_planner():
    import sys

    sys.path.insert(0, str(WEB_DIR))
    from production_planner_core import ProductionPlanner

    return ProductionPlanner.from_excel()


def add_synthetic_power_names(locale: str, names: dict[str, str], planner) -> None:
    for recipe in planner.recipes:
        if not recipe.recipe_id.startswith("Recipe_Power_"):
            continue
        device_class = recipe.produced_in_classes[0] if recipe.produced_in_classes else ""
        device_name = names.get(device_class, planner.devices.get(device_class).name if device_class in planner.devices else device_class)
        fuel = recipe.inputs[0] if recipe.inputs else None
        fuel_name = names.get(fuel.item_class, fuel.item_name) if fuel else ""
        names[recipe.recipe_id] = f"{device_name} ({fuel_name})" if fuel_name else device_name

    for group in planner.power_groups:
        group_key = group.group_class.removeprefix("Desc_Power_").removesuffix("_C")
        power_name = POWER_LABELS[locale][group_key]
        device_class = ""
        for member_class in group.member_classes:
            recipe = next((candidate for candidate in planner.recipes if candidate.outputs and candidate.outputs[0].item_class == member_class), None)
            if recipe:
                device_class = recipe.produced_in_classes[0] if recipe.produced_in_classes else device_class
                fuel = recipe.inputs[0] if recipe.inputs else None
                device_name = names.get(device_class, planner.devices.get(device_class).name if device_class in planner.devices else group.group_name)
                fuel_name = names.get(fuel.item_class, fuel.item_name) if fuel else device_name
                names[member_class] = f"{power_name} ({fuel_name})"
        names[group.group_class] = power_name
    for item_class in planner.items:
        if item_class in names:
            continue
        match = re.fullmatch(r"Desc_Power_([^_]+)_(.+)_C", item_class)
        if not match:
            continue
        group_name, fuel_suffix = match.groups()
        group_class = f"Desc_Power_{group_name}_C"
        base_name = names.get(group_class, group_name).rsplit(" (", 1)[0]
        fuel_name = names.get(f"Desc_{fuel_suffix}_C", fuel_suffix)
        names[item_class] = f"{base_name} ({fuel_name})"


def docs_names(path: Path) -> dict[str, str]:
    raw = path.read_bytes()
    records = json.loads(raw.decode("utf-16"))
    names: dict[str, str] = {}
    for native_group in records:
        for entry in native_group.get("Classes", []):
            class_name = str(entry.get("ClassName", "")).strip()
            display_name = str(entry.get("mDisplayName", "")).strip()
            if class_name and display_name:
                names[class_name] = display_name
    return names


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    args = parse_args()
    docs_dir = args.game_dir / "CommunityResources" / "Docs"
    planner = load_planner()
    item_ids, recipe_ids, device_ids = set(planner.items), set(planner.recipes_by_id), set(planner.devices)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    sources: dict[str, dict[str, object]] = {}
    coverage: dict[str, dict[str, int]] = {}
    for locale, filename in LOCALES.items():
        source = docs_dir / filename
        if not source.exists():
            raise SystemExit(f"Missing official game localization: {source}")
        names = docs_names(source)
        add_synthetic_power_names(locale, names, planner)
        items = {key: names[key] for key in sorted(item_ids & names.keys())}
        recipes = {key: names[key] for key in sorted(recipe_ids & names.keys())}
        devices = {key: names[key] for key in sorted(device_ids & names.keys())}
        payload = {
            "schema": 1,
            "locale": locale,
            "gameBuildId": args.build_id,
            "items": items,
            "recipes": recipes,
            "devices": devices,
        }
        output = OUTPUT_DIR / f"game.{locale}.json"
        output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        sources[locale] = {
            "file": filename,
            "sha256": file_hash(source),
            "lastModified": source.stat().st_mtime_ns,
        }
        coverage[locale] = {
            "items": len(items),
            "itemsExpected": len(item_ids),
            "recipes": len(recipes),
            "recipesExpected": len(recipe_ids),
            "devices": len(devices),
            "devicesExpected": len(device_ids),
        }

    manifest = {
        "schema": 1,
        "game": "Satisfactory",
        "steamAppId": "526870",
        "gameBuildId": args.build_id,
        "sourceDocsDate": "2026-08-15",
        "verifiedOn": args.verified_on,
        "calculationDataChanged": False,
        "calculationDataNote": "Compared with the installed game data; no item, recipe, device, or plan result changed.",
        "locales": list(LOCALES),
        "sources": sources,
        "coverage": coverage,
    }
    (OUTPUT_DIR / "game-data-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(coverage, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
