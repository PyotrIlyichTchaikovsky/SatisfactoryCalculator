from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
I18N = ROOT / "satisfactory_calculator" / "recipe_web" / "i18n"

# The official game nouns come from Docs JSON. These strings belong to this website.
LANGUAGE_NAMES = {
    "en-US": "English", "fr-FR": "Français", "it-IT": "Italiano", "de-DE": "Deutsch",
    "es-ES": "Español", "ja-JP": "日本語", "ko-KR": "한국어", "pl-PL": "Polski",
    "pt-BR": "Português (Brasil)", "ru-RU": "Русский", "zh-CN": "简体中文",
    "zh-TW": "繁體中文", "uk-UA": "Українська",
}

COMMON = {
    "fr-FR": ["Langue", "Auto", "Objectifs de production", "Plans enregistrés", "Historique récent", "Ajouter un objet", "Enregistrer", "Calculer", "Objet", "Choisir un objet", "Débit par minute", "Filtre de recettes", "Choisir un matériau", "Effacer le matériau", "Réinitialiser", "Terminé", "Fermer", "Résultats", "Vue du plan", "Tableau fusionné", "Réinitialiser la disposition", "Signaler un problème", "Rechercher par nom", "Sélection récente", "Tous les matériaux", "Matériaux de palier", "Objets fabriqués", "Ressources brutes", "Objets à collecter", "Énergie"],
    "it-IT": ["Lingua", "Auto", "Obiettivi di produzione", "Piani salvati", "Cronologia recente", "Aggiungi oggetto", "Salva", "Calcola", "Oggetto", "Scegli un oggetto", "Quantità al minuto", "Filtro ricette", "Scegli materiale", "Rimuovi materiale", "Ripristina tutto", "Fatto", "Chiudi", "Risultati", "Vista piano", "Tabella unita", "Ripristina layout", "Segnala un problema", "Cerca per nome", "Selezionati di recente", "Tutti i materiali", "Materiali obiettivo per livello", "Oggetti prodotti", "Risorse grezze", "Collezionabili", "Energia"],
    "de-DE": ["Sprache", "Automatisch", "Produktionsziele", "Gespeicherte Pläne", "Letzte Pläne", "Objekt hinzufügen", "Speichern", "Berechnen", "Objekt", "Objekt auswählen", "Rate pro Minute", "Rezeptfilter", "Material auswählen", "Material löschen", "Alles zurücksetzen", "Fertig", "Schließen", "Ergebnisse", "Planansicht", "Zusammengeführte Tabelle", "Layout zurücksetzen", "Problem melden", "Nach Materialname suchen", "Zuletzt ausgewählt", "Alle Materialien", "Stufen-Zielmaterialien", "Hergestellte Objekte", "Rohstoffe", "Sammelobjekte", "Energie"],
    "es-ES": ["Idioma", "Automático", "Objetivos de producción", "Planes guardados", "Historial reciente", "Añadir objeto", "Guardar", "Calcular", "Objeto", "Elegir un objeto", "Cantidad por minuto", "Filtro de recetas", "Elegir material", "Quitar material", "Restablecer todo", "Listo", "Cerrar", "Resultados", "Vista del plan", "Tabla combinada", "Restablecer diseño", "Informar de un problema", "Buscar por nombre", "Seleccionados recientemente", "Todos los materiales", "Materiales objetivo por nivel", "Objetos fabricados", "Recursos en bruto", "Coleccionables", "Energía"],
    "ja-JP": ["言語", "自動", "生産目標", "保存したプラン", "最近の履歴", "アイテムを追加", "保存", "計算", "アイテム", "アイテムを選択", "毎分の生産量", "レシピフィルター", "素材を選択", "素材を解除", "すべてリセット", "完了", "閉じる", "結果", "プラン表示", "統合テーブル", "配置をリセット", "問題を報告", "素材名で検索", "最近選択したもの", "すべての素材", "ティア目標素材", "製造アイテム", "原材料", "収集品", "電力"],
    "ko-KR": ["언어", "자동", "생산 목표", "저장된 계획", "최근 기록", "아이템 추가", "저장", "계산", "아이템", "아이템 선택", "분당 생산량", "제작법 필터", "재료 선택", "재료 지우기", "모두 초기화", "완료", "닫기", "결과", "계획 보기", "통합 표", "배치 초기화", "문제 신고", "재료 이름 검색", "최근 선택", "모든 재료", "티어 목표 재료", "제작 아이템", "원재료", "수집품", "전력"],
    "pl-PL": ["Język", "Automatycznie", "Cele produkcji", "Zapisane plany", "Ostatnia historia", "Dodaj przedmiot", "Zapisz", "Oblicz", "Przedmiot", "Wybierz przedmiot", "Ilość na minutę", "Filtr receptur", "Wybierz materiał", "Wyczyść materiał", "Resetuj wszystko", "Gotowe", "Zamknij", "Wyniki", "Widok planu", "Tabela zbiorcza", "Resetuj układ", "Zgłoś problem", "Szukaj po nazwie", "Ostatnio wybrane", "Wszystkie materiały", "Materiały docelowe poziomów", "Wytwarzane przedmioty", "Surowce", "Przedmioty do zebrania", "Energia"],
    "pt-BR": ["Idioma", "Automático", "Metas de produção", "Planos salvos", "Histórico recente", "Adicionar item", "Salvar", "Calcular", "Item", "Escolher um item", "Taxa por minuto", "Filtro de receitas", "Escolher material", "Limpar material", "Redefinir tudo", "Concluir", "Fechar", "Resultados", "Visão do plano", "Tabela consolidada", "Redefinir layout", "Relatar um problema", "Buscar pelo nome", "Selecionados recentemente", "Todos os materiais", "Materiais-alvo por nível", "Itens fabricados", "Recursos brutos", "Colecionáveis", "Energia"],
    "ru-RU": ["Язык", "Авто", "Цели производства", "Сохранённые планы", "Недавняя история", "Добавить предмет", "Сохранить", "Рассчитать", "Предмет", "Выбрать предмет", "Количество в минуту", "Фильтр рецептов", "Выбрать материал", "Очистить материал", "Сбросить всё", "Готово", "Закрыть", "Результаты", "Схема", "Сводная таблица", "Сбросить расположение", "Сообщить о проблеме", "Поиск по названию", "Недавно выбранные", "Все материалы", "Целевые материалы этапов", "Производимые предметы", "Сырьё", "Коллекционные предметы", "Энергия"],
    "zh-CN": ["语言", "自动", "生产目标", "已保存方案", "最近记录", "添加材料", "保存", "计算", "材料", "选择材料", "每分钟产量", "配方筛选", "选择材料", "清除材料", "全部重置", "完成", "关闭", "结果", "方案视图", "汇总表", "重置布局", "报告问题", "按材料名称搜索", "最近选择", "全部材料", "里程碑目标材料", "制造材料", "原始资源", "采集物", "电力"],
    "zh-TW": ["語言", "自動", "生產目標", "已儲存方案", "最近記錄", "新增材料", "儲存", "計算", "材料", "選擇材料", "每分鐘產量", "配方篩選", "選擇材料", "清除材料", "全部重設", "完成", "關閉", "結果", "方案檢視", "彙總表", "重設版面", "回報問題", "依材料名稱搜尋", "最近選擇", "全部材料", "里程碑目標材料", "製造材料", "原始資源", "收集物", "電力"],
    "uk-UA": ["Мова", "Авто", "Цілі виробництва", "Збережені плани", "Недавня історія", "Додати предмет", "Зберегти", "Розрахувати", "Предмет", "Вибрати предмет", "Кількість за хвилину", "Фільтр рецептів", "Вибрати матеріал", "Очистити матеріал", "Скинути все", "Готово", "Закрити", "Результати", "Схема", "Зведена таблиця", "Скинути розташування", "Повідомити про проблему", "Пошук за назвою", "Нещодавно вибрані", "Усі матеріали", "Цільові матеріали етапів", "Вироблені предмети", "Сировина", "Колекційні предмети", "Енергія"],
}

LOADING_COPY = {
    "fr-FR": ["Chargement du planificateur de production…", "Préparation des données des matériaux et des recettes. La première ouverture peut prendre quelques secondes.", "Les matériaux sont prêts. Chargement du catalogue de recettes…", "Impossible de charger le planificateur", "Vérifiez votre connexion, puis réessayez.", "Réessayer"],
    "it-IT": ["Caricamento del pianificatore di produzione…", "Preparazione dei dati di materiali e ricette. Il primo avvio può richiedere alcuni secondi.", "I materiali sono pronti. Caricamento del catalogo delle ricette…", "Impossibile caricare il pianificatore", "Controlla la connessione e riprova.", "Riprova"],
    "de-DE": ["Produktionsplaner wird geladen…", "Material- und Rezeptdaten werden vorbereitet. Der erste Aufruf kann einige Sekunden dauern.", "Materialien sind bereit. Der Rezeptkatalog wird geladen…", "Der Planer konnte nicht geladen werden", "Überprüfe deine Verbindung und versuche es erneut.", "Erneut versuchen"],
    "es-ES": ["Cargando el planificador de producción…", "Preparando los datos de materiales y recetas. La primera visita puede tardar unos segundos.", "Los materiales están listos. Cargando el catálogo de recetas…", "No se pudo cargar el planificador", "Comprueba tu conexión e inténtalo de nuevo.", "Reintentar"],
    "ja-JP": ["生産プランナーを読み込んでいます…", "素材とレシピのデータを準備しています。初回は数秒かかる場合があります。", "素材の準備が完了しました。レシピ一覧を読み込んでいます…", "プランナーを読み込めませんでした", "接続を確認して、もう一度お試しください。", "再読み込み"],
    "ko-KR": ["생산 플래너를 불러오는 중…", "재료와 제작법 데이터를 준비하고 있습니다. 처음 열 때는 몇 초 정도 걸릴 수 있습니다.", "재료 준비가 완료되었습니다. 제작법 목록을 불러오는 중…", "플래너를 불러올 수 없습니다", "연결을 확인한 후 다시 시도하세요.", "다시 시도"],
    "pl-PL": ["Wczytywanie planera produkcji…", "Przygotowywanie danych materiałów i receptur. Pierwsze uruchomienie może potrwać kilka sekund.", "Materiały są gotowe. Wczytywanie katalogu receptur…", "Nie udało się wczytać planera", "Sprawdź połączenie i spróbuj ponownie.", "Spróbuj ponownie"],
    "pt-BR": ["Carregando o planejador de produção…", "Preparando os dados de materiais e receitas. O primeiro acesso pode levar alguns segundos.", "Os materiais estão prontos. Carregando o catálogo de receitas…", "Não foi possível carregar o planejador", "Verifique sua conexão e tente novamente.", "Tentar novamente"],
    "ru-RU": ["Загрузка планировщика производства…", "Подготавливаются данные материалов и рецептов. Первый запуск может занять несколько секунд.", "Материалы готовы. Загружается каталог рецептов…", "Не удалось загрузить планировщик", "Проверьте подключение и повторите попытку.", "Повторить"],
    "zh-CN": ["正在加载生产规划工具……", "正在准备材料和配方数据，首次打开可能需要几秒钟。", "材料已准备完成，正在加载配方目录……", "生产规划工具加载失败", "请检查网络连接，然后重试。", "重新加载"],
    "zh-TW": ["正在載入生產規劃工具……", "正在準備材料和配方資料，首次開啟可能需要幾秒鐘。", "材料已準備完成，正在載入配方目錄……", "生產規劃工具載入失敗", "請檢查網路連線，然後重試。", "重新載入"],
    "uk-UA": ["Завантаження планувальника виробництва…", "Підготовка даних матеріалів і рецептів. Перший запуск може тривати кілька секунд.", "Матеріали готові. Завантаження каталогу рецептів…", "Не вдалося завантажити планувальник", "Перевірте з’єднання та спробуйте ще раз.", "Спробувати ще раз"],
}

LOADING_KEYS = [
    "loading.title", "loading.preparing", "loading.recipes", "loading.failedTitle", "loading.failed", "loading.retry",
]

PRIVACY_COPY = {
    "fr-FR": "Confidentialité", "it-IT": "Privacy", "de-DE": "Datenschutz", "es-ES": "Privacidad",
    "ja-JP": "プライバシー", "ko-KR": "개인정보 보호", "pl-PL": "Prywatność", "pt-BR": "Privacidade",
    "ru-RU": "Конфиденциальность", "zh-CN": "隐私", "zh-TW": "隱私", "uk-UA": "Конфіденційність",
}

KEYS = [
    "language.label", "language.auto", "targets.title", "targets.saved", "targets.history", "targets.add",
    "targets.save", "targets.calculate", "targets.item", "targets.chooseItem", "targets.rate", "recipes.filter",
    "recipes.chooseMaterial", "recipes.clearMaterial", "recipes.resetAll", "recipes.done", "recipes.close",
    "results.title", "results.planView", "results.tableView", "results.resetLayout", "diagnostics.report",
    "picker.search", "picker.recent", "picker.all", "picker.tierMaterials", "picker.manufactured",
    "picker.raw", "picker.collectibles", "picker.power",
]

ZH_EXTRA = {
    "zh-CN": {
        "app.title": "Satisfactory 生产规划工具", "app.description": "规划 Satisfactory 的生产目标、配方、原始资源与工厂流程。",
        "app.connecting": "正在连接生产规划服务……", "targets.noSaved": "没有已保存方案", "targets.noHistory": "没有最近记录",
        "calculating.title": "正在计算生产方案……", "calculating.message": "正在计算生产方案，请稍候。",
        "targets.selectSaved": "选择已保存方案", "targets.selectHistory": "选择最近方案", "targets.chooseTarget": "选择目标材料",
        "targets.chooseTargetHelp": "选择工厂需要生产的材料。", "targets.remove": "移除材料", "recipes.required": "所需配方",
        "recipes.chooseSearchMaterial": "选择要查找配方的材料", "recipes.chooseSearchHelp": "选择材料后只显示它可用的配方。",
        "recipes.search": "搜索材料或配方", "recipes.searchRequired": "搜索所需配方", "recipes.none": "没有匹配的配方。",
        "recipes.baseTag": "[基础配方]", "recipes.recipeTag": "[配方]", "recipes.directRaw": "直接将{name}作为原材料",
        "recipes.directRawName": "直接使用{name}",
        "recipes.hint": "同一配方可能出现在多个材料下；勾选任意一处会同步更新所有位置。",
        "results.initial": "请选择一个或多个材料，并输入每分钟所需产量。", "results.views": "结果视图", "results.recipes": "配方",
        "results.noPlan": "当前条件下无法显示生产方案。", "results.noTable": "当前条件下无法显示汇总表。",
        "results.findRecipe": "查找配方", "results.locateChanged": "定位改动", "results.findRecipeSearch": "搜索配方或产出材料",
        "results.findRecipeChooseMaterial": "选择材料", "results.findRecipeMaterial": "选择当前方案中的材料",
        "results.findRecipeMaterialHelp": "选择产出材料，只显示当前方案中对应的配方。", "results.findRecipeCount": "匹配 {count} 个配方",
        "results.findRecipeNone": "当前方案中没有匹配的配方。",
        "results.noTarget": "尚未计算生产目标。", "results.noDownstream": "所选目标没有下游材料需求。",
        "results.targetOutputs": "目标产出", "results.supplyLayer": "供应层 {index}", "results.sharedSupply": "共享／循环供应",
        "results.externalInput": "外部输入", "results.drag": "拖动", "diagnostics.details": "技术信息和方案输入",
        "diagnostics.copy": "复制报告", "diagnostics.download": "下载报告", "diagnostics.github": "打开 GitHub 问题页",
        "diagnostics.close": "关闭", "diagnostics.notice": "分享至 GitHub 前请先检查此报告。报告包含当前方案和最近的计算输入；这些按钮不会自动发送任何内容。",
        "diagnostics.copied": "报告已复制。请把它连同操作步骤和预期结果粘贴到问题中。",
        "diagnostics.copyFailed": "无法自动复制。请复制已选中的文字，或下载报告。", "picker.title": "选择材料",
        "picker.help": "先选择分类，再选择材料。", "picker.close": "关闭材料选择窗口", "picker.searchAria": "搜索材料",
        "picker.categories": "材料分类", "picker.materials": "材料", "picker.empty": "没有符合搜索条件的材料。",
        "picker.select": "选择{name}", "picker.tier": "Tier {tier}", "picker.count.one": "{count} 个材料", "picker.count.other": "{count} 个材料",
        "status.itemsLoading": "已准备 {count} 个材料 · 正在加载配方目录……", "status.itemsReady": "材料已就绪。配方目录加载期间可以先选择目标。",
        "status.loaded": "已从服务器加载配方数据。请选择材料并输入每分钟产量。", "status.connectionFailed": "无法连接生产规划服务",
        "status.loadingRecipes": "配方目录仍在加载，请稍候再计算。", "status.calculating": "正在向服务器请求计算……",
        "status.optimized": "已优化 {targets} 个目标，使用 {recipes} 个配方，已选 {selected} 个配方，外部输入 {external}/分钟，合并为 {rows} 行材料。",
        "status.saved": "已保存目标方案：{plan}。", "status.addTarget": "请至少添加一个目标材料并输入每分钟产量。",
        "status.invalidRate": "请输入{name}的正数每分钟产量。", "status.unmatched": "无法匹配材料：{name}",
        "status.scaled": "已将当前结果缩放 {factor} 倍，无需再次请求服务器。", "summary.loaded": "{recipes} 个配方 · {items} 个材料 · {raw} 种原始资源",
        "category.NormalMaterial": "制造材料", "category.RawMaterial": "原始资源", "category.PickupMaterial": "采集物", "category.Power": "电力",
        "kind.output": "产出", "kind.surplus": "余量", "kind.recipe": "配方", "kind.alternateRecipe": "替代配方", "kind.intermediate": "中间材料",
        "table.item": "材料", "table.required": "需求量／分钟", "table.unit": "单位", "table.type": "类型", "table.recipes": "使用的配方"
    },
    "zh-TW": {
        "app.title": "Satisfactory 生產規劃工具", "app.description": "規劃 Satisfactory 的生產目標、配方、原始資源與工廠流程。",
        "app.connecting": "正在連線生產規劃服務……", "calculating.title": "正在計算生產方案……", "calculating.message": "正在計算生產方案，請稍候。", "targets.chooseTarget": "選擇目標材料", "targets.chooseTargetHelp": "選擇工廠需要生產的材料。",
        "recipes.baseTag": "[基礎配方]", "recipes.recipeTag": "[配方]", "results.initial": "請選擇一個或多個材料，並輸入每分鐘所需產量。",
        "recipes.directRawName": "直接使用{name}", "results.findRecipe": "尋找配方", "results.locateChanged": "定位變更",
        "results.findRecipeSearch": "搜尋配方或產出材料", "results.findRecipeChooseMaterial": "選擇材料",
        "results.findRecipeMaterial": "選擇目前方案中的材料", "results.findRecipeMaterialHelp": "選擇產出材料，只顯示目前方案中對應的配方。",
        "results.findRecipeCount": "符合 {count} 個配方", "results.findRecipeNone": "目前方案中沒有符合的配方。",
        "picker.title": "選擇材料", "picker.help": "先選擇分類，再選擇材料。", "picker.empty": "沒有符合搜尋條件的材料。",
        "picker.select": "選擇{name}", "picker.count.one": "{count} 個材料", "picker.count.other": "{count} 個材料",
        "category.NormalMaterial": "製造材料", "category.RawMaterial": "原始資源", "category.PickupMaterial": "收集物", "category.Power": "電力",
        "kind.output": "產出", "kind.surplus": "餘量", "kind.recipe": "配方", "kind.alternateRecipe": "替代配方", "kind.intermediate": "中間材料",
        "table.item": "材料", "table.required": "需求量／分鐘", "table.unit": "單位", "table.type": "類型", "table.recipes": "使用的配方"
    }
}


def main() -> None:
    english = json.loads((I18N / "ui.en-US.json").read_text(encoding="utf-8"))
    for locale, values in COMMON.items():
        data = {key: value for key, value in zip(KEYS, values, strict=True)}
        data.update({key: value for key, value in zip(LOADING_KEYS, LOADING_COPY[locale], strict=True)})
        data.update(ZH_EXTRA.get(locale, {}))
        data["privacy.link"] = PRIVACY_COPY[locale]
        data = {key: value for key, value in data.items() if not key.startswith("diagnostics.")}
        (I18N / f"ui.{locale}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    (I18N / "locales.json").write_text(
        json.dumps({"schema": 1, "defaultLocale": "en-US", "locales": LANGUAGE_NAMES}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Generated {len(COMMON) + 1} UI locale files with English fallback ({len(english)} keys).")


if __name__ == "__main__":
    main()
