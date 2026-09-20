from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "satisfactory_calculator" / "recipe_web" / "i18n" / "game.en-US.json"
DEFAULT_OUTPUT = ROOT / "satisfactory_calculator" / "recipe_web" / "data" / "material_progression.json"
CLASS_RE = re.compile(r"((?:Desc|BP_ItemDescriptor)[A-Za-z0-9_]+_C)")
RECIPE_RE = re.compile(r"(Recipe_[A-Za-z0-9_]+_C)")
TYPE_ORDER = {
    "EST_Tutorial": 0,
    "EST_Milestone": 1,
    "EST_MAM": 2,
    "EST_Custom": 3,
    "EST_ResourceSink": 4,
    "EST_Alternate": 5,
    "EST_HardDrive": 6,
    "EST_Customization": 7,
}
EARLY_PICKUPS = [
    "Desc_Leaves_C", "Desc_Wood_C", "Desc_Mycelia_C",
    "Desc_HogParts_C", "Desc_SpitterParts_C", "Desc_HatcherParts_C", "Desc_StingerParts_C",
    "Desc_Crystal_C", "Desc_Crystal_mk2_C", "Desc_Crystal_mk3_C",
]


def load_raw_data(path: Path) -> list[dict]:
    raw = path.read_bytes()
    encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    value = json.loads(raw.decode(encoding))
    if not isinstance(value, list):
        raise ValueError("Raw game data must be a JSON array")
    return value


def classes_for(groups: list[dict], native_name: str) -> list[dict]:
    return next(group["Classes"] for group in groups if native_name in group.get("NativeClass", ""))


def schematic_key(schematic: dict, source_index: int) -> tuple:
    tier = int(schematic.get("mTechTier") or 99)
    class_name = schematic.get("ClassName", "")
    type_rank = TYPE_ORDER.get(schematic.get("mType", ""), 8)
    if class_name == "Schematic_StartingRecipes_C":
        return (-1, -1, 0.0, source_index, class_name)
    if schematic.get("mType") == "EST_MAM" and tier == 0:
        tier = 3
    return (tier, type_rank, float(schematic.get("mMenuPriority") or 0), source_index, class_name)


def build_progression(groups: list[dict], catalog_classes: set[str]) -> list[str]:
    recipes = {recipe["ClassName"]: recipe for recipe in classes_for(groups, "FGRecipe'")}
    schematics = classes_for(groups, "FGSchematic'")
    direct_candidates: dict[str, tuple] = {}
    recipe_candidates: list[tuple[tuple, int, int, float, str, list[str]]] = []

    def record_direct(item_class: str, key: tuple) -> None:
        key = (key[0], *key[1:5], 0, *key[5:])
        if item_class in catalog_classes and (item_class not in direct_candidates or key < direct_candidates[item_class]):
            direct_candidates[item_class] = key

    for schematic_index, schematic in enumerate(schematics):
        if schematic.get("mRelevantEvents"):
            continue
        if schematic.get("mType") == "EST_Custom" and schematic.get("ClassName") != "Schematic_StartingRecipes_C":
            continue
        if schematic.get("mType") not in {"EST_Tutorial", "EST_Milestone", "EST_MAM", "EST_Custom"}:
            continue
        base_key = schematic_key(schematic, schematic_index)
        for unlock_index, unlock in enumerate(schematic.get("mUnlocks") or []):
            if unlock.get("Class") == "BP_UnlockRecipe_C":
                for recipe_index, recipe_id in enumerate(RECIPE_RE.findall(unlock.get("mRecipes", ""))):
                    recipe = recipes.get(recipe_id)
                    if not recipe:
                        continue
                    recipe_priority = float(recipe.get("mManufacturingMenuPriority") or 0)
                    inputs = CLASS_RE.findall(recipe.get("mIngredients", ""))
                    for product_index, item_class in enumerate(CLASS_RE.findall(recipe.get("mProduct", ""))):
                        if item_class in catalog_classes:
                            recipe_candidates.append((base_key, unlock_index, recipe_index, recipe_priority, item_class, inputs))
            scanner_resources = " ".join([
                unlock.get("mResourcesToAddToScanner", ""), unlock.get("mResourcePairsToAddToScanner", ""),
            ])
            for resource_index, item_class in enumerate(dict.fromkeys(CLASS_RE.findall(scanner_resources))):
                record_direct(item_class, (*base_key, unlock_index, -1, -1.0, resource_index))

    candidates = dict(direct_candidates)
    for early_index, item_class in enumerate(EARLY_PICKUPS):
        if item_class in catalog_classes:
            candidates[item_class] = (-2, 0, 0.0, early_index, "early-pickup", 0)
    unresolved = list(recipe_candidates)
    while unresolved:
        next_unresolved = []
        changed = False
        for base_key, unlock_index, recipe_index, recipe_priority, item_class, inputs in unresolved:
            catalog_inputs = [item for item in inputs if item in catalog_classes]
            if any(item not in candidates for item in catalog_inputs):
                next_unresolved.append((base_key, unlock_index, recipe_index, recipe_priority, item_class, inputs))
                continue
            effective_tier = max([base_key[0], *(candidates[item][0] for item in catalog_inputs)])
            dependency_depth = 1 + max([0, *(candidates[item][5] for item in catalog_inputs)])
            key = (effective_tier, *base_key[1:], dependency_depth, unlock_index, recipe_index, recipe_priority)
            if item_class not in candidates or key < candidates[item_class]:
                candidates[item_class] = key
            changed = True
        if not changed:
            break
        unresolved = next_unresolved

    for base_key, unlock_index, recipe_index, recipe_priority, item_class, _inputs in unresolved:
        key = (99, *base_key[1:], 99, unlock_index, recipe_index, recipe_priority)
        if item_class not in candidates or key < candidates[item_class]:
            candidates[item_class] = key

    ordered = [item for item, _key in sorted(candidates.items(), key=lambda pair: (pair[1], pair[0]))]
    early = [item for item in EARLY_PICKUPS if item in catalog_classes and item not in ordered]
    remaining = sorted(catalog_classes - set(ordered) - set(early))
    return early + ordered + remaining


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a language-independent material order from Satisfactory unlock data")
    parser.add_argument("raw_data", type=Path)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    catalog_classes = set(catalog.get("items", {}))
    order = build_progression(load_raw_data(args.raw_data), catalog_classes)
    payload = {"schema": 1, "source": "Satisfactory schematic unlock progression", "items": order}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(order)} material ranks to {args.output}")


if __name__ == "__main__":
    main()
