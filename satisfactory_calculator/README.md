# Satisfactory Calculator

## Directory Layout

- `recipe_exporter/`: code and config for reading Satisfactory game data and exporting the Excel workbook.
- `recipe_web/`: Python web service, calculation module, and static assets for the production planner.
- `raw_data/`: generated Excel workbooks from the exporter.

## Usage

Install Python dependencies:

```powershell
py -m pip install -r requirements.txt
```

Generate or refresh the Excel workbook:

```powershell
py .\recipe_exporter\satisfactory_recipes_export.py
```

Start the planner web service:

```powershell
py .\recipe_web\production_planner_server.py
```

Open the planner page in a browser:

```text
http://127.0.0.1:8000/
```
