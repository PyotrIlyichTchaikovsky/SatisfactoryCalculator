FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLANNER_LOG_LEVEL=INFO

WORKDIR /app

COPY satisfactory_calculator/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r /app/requirements.txt

COPY satisfactory_calculator/recipe_web /app/recipe_web

WORKDIR /app/recipe_web

CMD ["sh", "-c", "python -m uvicorn production_planner_app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers"]
