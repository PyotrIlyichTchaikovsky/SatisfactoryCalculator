# Satisfactory Calculator

## Directory Layout

- `data_exporter/`: code, config, and raw snapshots for exporting game data and rebuilding the planner workbook.
- `recipe_web/`: Python web service, calculation module, and static assets for the production planner.

## Usage

Install Python dependencies:

```powershell
py -m pip install -r requirements.txt
```

Export the raw game data snapshot and rebuild the planner data workbook:

```powershell
py .\data_exporter\data_exporter.py
```

Start the planner web service:

```powershell
py .\recipe_web\production_planner_server.py
```

Open the planner page in a browser:

```text
http://127.0.0.1:8000/
```
