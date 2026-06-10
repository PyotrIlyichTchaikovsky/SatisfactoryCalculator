#!/usr/bin/env python3
"""Run the full Satisfactory data export pipeline."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

import game_rawdata_exporter
import raw_to_data


SCRIPT_DIR = Path(__file__).resolve().parent


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    raw_result = game_rawdata_exporter.main(["--config", str(args.raw_config)])
    if raw_result:
        return raw_result

    return raw_to_data.main(["--config", str(args.data_config)])


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export RawData.json and rebuild planner Data.xlsx.")
    parser.add_argument(
        "--raw-config",
        type=Path,
        default=SCRIPT_DIR / "game_rawdata_exporter.config.json",
        help="Path to game_rawdata_exporter.config.json.",
    )
    parser.add_argument(
        "--data-config",
        type=Path,
        default=SCRIPT_DIR / "raw_to_data.config.json",
        help="Path to raw_to_data.config.json.",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
