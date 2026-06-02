# Satisfactory Calculator

## Directory Layout

- `recipe_exporter/`: code and config for reading Satisfactory game data and exporting recipe data.
- `recipe_web/`: interactive recipe planner web page and its static assets.
- `raw_data/`: generated Excel workbooks from the exporter.

## Usage

Generate the Excel workbook and refresh the web planner data:

```powershell
py .\recipe_exporter\satisfactory_recipes_export.py
```

Open the planner page:

```text
recipe_web/production_planner.html
```
