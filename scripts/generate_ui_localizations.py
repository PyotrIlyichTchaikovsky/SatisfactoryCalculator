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

RECIPE_SHORT_LABELS = {
    "fr-FR": "Recettes", "it-IT": "Ricette", "de-DE": "Rezepte", "es-ES": "Recetas",
    "ja-JP": "レシピ", "ko-KR": "제작법", "pl-PL": "Receptury", "pt-BR": "Receitas",
    "ru-RU": "Рецепты", "zh-CN": "配方", "zh-TW": "配方", "uk-UA": "Рецепти",
}

# Complete the user-facing keys used by the current planner. These are kept
# separately from the compact shared label list so every shipped locale is explicit.
LIVE_UI_COPY = {
    "fr-FR": {
        "app.title": "Planificateur de production Satisfactory", "app.connecting": "Connexion au service du planificateur de production…",
        "calculating.message": "Le plan de production est en cours de calcul. Veuillez patienter.", "calculating.title": "Calcul du plan de production…",
        "category.NormalMaterial": "Objet fabriqué", "category.PickupMaterial": "Objet à collecter", "category.Power": "Énergie", "category.RawMaterial": "Matière première",
        "focus.enterBrowser": "Plein écran du navigateur", "focus.enterPage": "Agrandir la vue des résultats", "focus.exit": "Quitter le plein écran",
        "info.title": "Informations du plan", "kind.alternateRecipe": "Recette alternative", "kind.output": "Production", "kind.recipe": "Recette", "kind.surplus": "Excédent",
        "picker.categories": "Catégories de matériaux", "picker.close": "Fermer le sélecteur de matériaux", "picker.count.one": "{count} matériau", "picker.count.other": "{count} matériaux",
        "picker.empty": "Aucun matériau ne correspond à cette recherche.", "picker.help": "Choisissez une catégorie, puis un matériau.", "picker.materials": "Matériaux",
        "picker.searchAria": "Rechercher des matériaux", "picker.select": "Sélectionner {name}", "picker.tier": "Niveau {tier}", "picker.title": "Choisir un matériau",
        "recipes.baseTag": "[Recette de base]", "recipes.chooseSearchHelp": "Choisissez un matériau pour n’afficher que ses recettes disponibles.",
        "recipes.chooseSearchMaterial": "Choisir un matériau pour rechercher des recettes", "recipes.directRaw": "Utiliser directement {name} comme ressource brute",
        "recipes.directRawName": "Utiliser directement {name}", "recipes.hint": "Une recette peut apparaître sous plusieurs matériaux ; la cocher à un endroit met à jour toutes ses occurrences.",
        "recipes.material": "Matériau : {name}", "recipes.none": "Aucune recette correspondante.", "recipes.recipeTag": "[Recette]", "recipes.required": "Recettes requises",
        "recipes.search": "Rechercher des matériaux ou des recettes", "recipes.searchRequired": "Rechercher parmi les recettes requises",
        "results.compactExitHint": "Cliquez sur un espace vide pour revenir", "results.compactFocus": "Centrer sur cette recette", "results.findRecipe": "Rechercher une recette",
        "results.findRecipeChooseMaterial": "Choisir un matériau", "results.findRecipeCount": "{count} recette(s) correspondante(s)",
        "results.findRecipeMaterial": "Choisir un matériau du plan actuel", "results.findRecipeMaterialHelp": "Choisissez un matériau produit pour n’afficher que ses recettes dans ce plan.",
        "results.findRecipeNone": "Aucune recette correspondante dans le plan actuel.", "results.findRecipeSearch": "Rechercher des recettes ou des matériaux produits",
        "results.initial": "Sélectionnez un ou plusieurs matériaux et indiquez la quantité à produire par minute.", "results.locateChanged": "Localiser les modifications",
        "results.noPlan": "Impossible d’afficher un plan de production avec les conditions actuelles.", "results.noTarget": "Aucun objectif de production n’a encore été calculé.",
        "status.addTarget": "Ajoutez au moins un matériau cible et indiquez une quantité par minute.", "status.calculating": "Calcul demandé au serveur…",
        "status.connectionFailed": "Impossible de se connecter au service de planification de production", "status.invalidRate": "Saisissez un débit positif par minute pour {name}.",
        "status.itemsLoading": "{count} matériaux prêts · Chargement du catalogue de recettes…", "status.itemsReady": "Les matériaux sont prêts. Vous pouvez choisir des objectifs pendant le chargement des recettes.",
        "status.loadingRecipes": "Le catalogue de recettes est encore en cours de chargement. Veuillez patienter avant de calculer.",
        "status.optimized": "{targets} objectif(s) optimisé(s), {recipes} recette(s) utilisées, {selected} recette(s) sélectionnées, entrée externe : {external} /min, regroupées en {rows} ligne(s) de matériau.",
        "status.saved": "Plan cible enregistré : {plan}.", "status.scaled": "Résultat actuel multiplié par {factor}, sans nouvelle requête au serveur.",
        "status.unmatched": "Impossible de trouver le matériau : {name}", "summary.loaded": "{recipes} recettes · {items} matériaux · {raw} ressources brutes",
        "targets.chooseTarget": "Choisir le matériau cible", "targets.chooseTargetHelp": "Choisissez le matériau que l’usine doit produire.",
        "targets.noSaved": "Aucun plan enregistré", "targets.remove": "Supprimer le matériau",
    },
    "it-IT": {
        "app.title": "Pianificatore di produzione Satisfactory", "app.connecting": "Connessione al servizio di pianificazione della produzione…",
        "calculating.message": "Calcolo del piano di produzione in corso. Attendi.", "calculating.title": "Calcolo del piano di produzione…",
        "category.NormalMaterial": "Oggetto prodotto", "category.PickupMaterial": "Oggetto raccoglibile", "category.Power": "Energia", "category.RawMaterial": "Materia prima",
        "focus.enterBrowser": "Schermo intero del browser", "focus.enterPage": "Espandi la vista dei risultati", "focus.exit": "Esci dalla visualizzazione a schermo intero",
        "info.title": "Informazioni sul piano", "kind.alternateRecipe": "Ricetta alternativa", "kind.output": "Produzione", "kind.recipe": "Ricetta", "kind.surplus": "Surplus",
        "picker.categories": "Categorie dei materiali", "picker.close": "Chiudi il selettore dei materiali", "picker.count.one": "{count} materiale", "picker.count.other": "{count} materiali",
        "picker.empty": "Nessun materiale corrisponde alla ricerca.", "picker.help": "Scegli una categoria, poi seleziona un materiale.", "picker.materials": "Materiali",
        "picker.searchAria": "Cerca materiali", "picker.select": "Seleziona {name}", "picker.tier": "Livello {tier}", "picker.title": "Scegli materiale",
        "recipes.baseTag": "[Ricetta base]", "recipes.chooseSearchHelp": "Scegli un materiale per mostrare solo le ricette disponibili.",
        "recipes.chooseSearchMaterial": "Scegli un materiale per cercare ricette", "recipes.directRaw": "Usa direttamente {name} come materia prima",
        "recipes.directRawName": "Usa {name} direttamente", "recipes.hint": "La stessa ricetta può comparire sotto più materiali; selezionarla in una riga aggiorna tutte le occorrenze.",
        "recipes.material": "Materiale: {name}", "recipes.none": "Nessuna ricetta corrispondente.", "recipes.recipeTag": "[Ricetta]", "recipes.required": "Ricette richieste",
        "recipes.search": "Cerca materiali o ricette", "recipes.searchRequired": "Cerca tra le ricette richieste",
        "results.compactExitHint": "Fai clic su uno spazio vuoto per tornare indietro", "results.compactFocus": "Metti a fuoco questa ricetta", "results.findRecipe": "Cerca ricetta",
        "results.findRecipeChooseMaterial": "Scegli materiale", "results.findRecipeCount": "{count} ricetta/e corrispondente/i",
        "results.findRecipeMaterial": "Scegli un materiale nel piano corrente", "results.findRecipeMaterialHelp": "Scegli un materiale prodotto per mostrare solo le relative ricette in questo piano.",
        "results.findRecipeNone": "Nessuna ricetta corrispondente nel piano corrente.", "results.findRecipeSearch": "Cerca ricette o materiali prodotti",
        "results.initial": "Seleziona uno o più materiali e inserisci la quantità da produrre al minuto.", "results.locateChanged": "Individua le modifiche",
        "results.noPlan": "Impossibile mostrare un piano di produzione con le condizioni attuali.", "results.noTarget": "Non è ancora stato calcolato alcun obiettivo di produzione.",
        "status.addTarget": "Aggiungi almeno un materiale obiettivo e inserisci una quantità al minuto.", "status.calculating": "Richiesta di calcolo inviata al server…",
        "status.connectionFailed": "Impossibile connettersi al servizio di pianificazione della produzione", "status.invalidRate": "Inserisci una quantità positiva al minuto per {name}.",
        "status.itemsLoading": "{count} materiali pronti · Caricamento del catalogo delle ricette…", "status.itemsReady": "I materiali sono pronti. Puoi scegliere gli obiettivi mentre si caricano le ricette.",
        "status.loadingRecipes": "Il catalogo delle ricette è ancora in caricamento. Attendi prima di calcolare.",
        "status.optimized": "Ottimizzati {targets} obiettivi, {recipes} ricette usate, {selected} ricette selezionate, input esterno {external} /min, raggruppato in {rows} righe di materiale.",
        "status.saved": "Piano obiettivo salvato: {plan}.", "status.scaled": "Risultato corrente moltiplicato per {factor}, senza inviare una nuova richiesta al server.",
        "status.unmatched": "Impossibile trovare il materiale: {name}", "summary.loaded": "{recipes} ricette · {items} materiali · {raw} risorse grezze",
        "targets.chooseTarget": "Scegli il materiale obiettivo", "targets.chooseTargetHelp": "Scegli il materiale che la fabbrica deve produrre.",
        "targets.noSaved": "Nessun piano salvato", "targets.remove": "Rimuovi materiale",
    },
    "de-DE": {
        "app.title": "Satisfactory-Produktionsplaner", "app.connecting": "Verbindung zum Produktionsplaner wird hergestellt…",
        "calculating.message": "Der Produktionsplan wird berechnet. Bitte warten.", "calculating.title": "Produktionsplan wird berechnet…",
        "category.NormalMaterial": "Hergestellter Gegenstand", "category.PickupMaterial": "Sammelobjekt", "category.Power": "Energie", "category.RawMaterial": "Rohstoff",
        "focus.enterBrowser": "Browser-Vollbild", "focus.enterPage": "Ergebnisansicht erweitern", "focus.exit": "Vollbildansicht schließen",
        "info.title": "Planinformationen", "kind.alternateRecipe": "Alternativrezept", "kind.output": "Ausgabe", "kind.recipe": "Rezept", "kind.surplus": "Überschuss",
        "picker.categories": "Materialkategorien", "picker.close": "Materialauswahl schließen", "picker.count.one": "{count} Material", "picker.count.other": "{count} Materialien",
        "picker.empty": "Keine Materialien entsprechen der Suche.", "picker.help": "Wähle zuerst eine Kategorie und dann ein Material.", "picker.materials": "Materialien",
        "picker.searchAria": "Materialien suchen", "picker.select": "{name} auswählen", "picker.tier": "Stufe {tier}", "picker.title": "Material auswählen",
        "recipes.baseTag": "[Grundrezept]", "recipes.chooseSearchHelp": "Wähle ein Material, um nur dessen verfügbare Rezepte anzuzeigen.",
        "recipes.chooseSearchMaterial": "Material für die Rezeptsuche auswählen", "recipes.directRaw": "{name} direkt als Rohstoff verwenden",
        "recipes.directRawName": "{name} direkt verwenden", "recipes.hint": "Dasselbe Rezept kann bei mehreren Materialien erscheinen; eine Auswahl wird überall übernommen.",
        "recipes.material": "Material: {name}", "recipes.none": "Keine passenden Rezepte.", "recipes.recipeTag": "[Rezept]", "recipes.required": "Benötigte Rezepte",
        "recipes.search": "Materialien oder Rezepte suchen", "recipes.searchRequired": "Benötigte Rezepte suchen",
        "results.compactExitHint": "Zum Zurückkehren auf eine freie Fläche klicken", "results.compactFocus": "Dieses Rezept fokussieren", "results.findRecipe": "Rezept suchen",
        "results.findRecipeChooseMaterial": "Material auswählen", "results.findRecipeCount": "{count} passende(s) Rezept(e)",
        "results.findRecipeMaterial": "Material im aktuellen Plan auswählen", "results.findRecipeMaterialHelp": "Wähle ein Ausgabe-Material, um nur dessen Rezepte in diesem Plan anzuzeigen.",
        "results.findRecipeNone": "Keine passenden Rezepte im aktuellen Plan.", "results.findRecipeSearch": "Rezepte oder Ausgabematerialien suchen",
        "results.initial": "Wähle ein oder mehrere Materialien und gib die gewünschte Produktionsmenge pro Minute ein.", "results.locateChanged": "Änderungen suchen",
        "results.noPlan": "Für die aktuellen Bedingungen kann kein Produktionsplan angezeigt werden.", "results.noTarget": "Es wurde noch kein Produktionsziel berechnet.",
        "status.addTarget": "Füge mindestens ein Zielmaterial hinzu und gib eine Menge pro Minute ein.", "status.calculating": "Berechnungsanfrage wird an den Server gesendet…",
        "status.connectionFailed": "Verbindung zum Produktionsplaner nicht möglich", "status.invalidRate": "Gib für {name} eine positive Produktionsmenge pro Minute ein.",
        "status.itemsLoading": "{count} Materialien bereit · Rezeptkatalog wird geladen…", "status.itemsReady": "Die Materialien sind bereit. Ziele können während des Ladens der Rezepte ausgewählt werden.",
        "status.loadingRecipes": "Der Rezeptkatalog wird noch geladen. Bitte warte kurz, bevor du berechnest.",
        "status.optimized": "{targets} Ziel(e) optimiert, {recipes} Rezept(e) verwendet, {selected} Rezept(e) ausgewählt, externe Eingabe {external} /min, auf {rows} Materialzeile(n) zusammengeführt.",
        "status.saved": "Zielplan gespeichert: {plan}.", "status.scaled": "Das aktuelle Ergebnis wurde mit {factor} multipliziert, ohne den Server erneut anzufragen.",
        "status.unmatched": "Material nicht gefunden: {name}", "summary.loaded": "{recipes} Rezepte · {items} Materialien · {raw} Rohstoffe",
        "targets.chooseTarget": "Zielmaterial auswählen", "targets.chooseTargetHelp": "Wähle das Material, das die Fabrik produzieren soll.",
        "targets.noSaved": "Keine gespeicherten Pläne", "targets.remove": "Material entfernen",
    },
    "es-ES": {
        "app.title": "Planificador de producción de Satisfactory", "app.connecting": "Conectando con el servicio del planificador de producción…",
        "calculating.message": "Calculando el plan de producción. Espera un momento.", "calculating.title": "Calculando el plan de producción…",
        "category.NormalMaterial": "Objeto fabricado", "category.PickupMaterial": "Objeto coleccionable", "category.Power": "Energía", "category.RawMaterial": "Recurso en bruto",
        "focus.enterBrowser": "Pantalla completa del navegador", "focus.enterPage": "Ampliar la vista de resultados", "focus.exit": "Cerrar la vista a pantalla completa",
        "info.title": "Información del plan", "kind.alternateRecipe": "Receta alternativa", "kind.output": "Salida", "kind.recipe": "Receta", "kind.surplus": "Excedente",
        "picker.categories": "Categorías de materiales", "picker.close": "Cerrar el selector de materiales", "picker.count.one": "{count} material", "picker.count.other": "{count} materiales",
        "picker.empty": "Ningún material coincide con la búsqueda.", "picker.help": "Elige una categoría y después un material.", "picker.materials": "Materiales",
        "picker.searchAria": "Buscar materiales", "picker.select": "Seleccionar {name}", "picker.tier": "Nivel {tier}", "picker.title": "Elegir material",
        "recipes.baseTag": "[Receta básica]", "recipes.chooseSearchHelp": "Elige un material para mostrar solo sus recetas disponibles.",
        "recipes.chooseSearchMaterial": "Elegir material para buscar recetas", "recipes.directRaw": "Usar {name} directamente como recurso en bruto",
        "recipes.directRawName": "Usar {name} directamente", "recipes.hint": "Una receta puede aparecer en varios materiales; marcarla en una fila actualiza todas sus apariciones.",
        "recipes.material": "Material: {name}", "recipes.none": "No hay recetas coincidentes.", "recipes.recipeTag": "[Receta]", "recipes.required": "Recetas necesarias",
        "recipes.search": "Buscar materiales o recetas", "recipes.searchRequired": "Buscar recetas necesarias",
        "results.compactExitHint": "Haz clic en un espacio vacío para volver", "results.compactFocus": "Enfocar esta receta", "results.findRecipe": "Buscar receta",
        "results.findRecipeChooseMaterial": "Elegir material", "results.findRecipeCount": "{count} receta(s) coincidente(s)",
        "results.findRecipeMaterial": "Elegir material del plan actual", "results.findRecipeMaterialHelp": "Elige un material producido para mostrar solo sus recetas en este plan.",
        "results.findRecipeNone": "No hay recetas coincidentes en el plan actual.", "results.findRecipeSearch": "Buscar recetas o materiales producidos",
        "results.initial": "Selecciona uno o varios materiales e introduce la cantidad que quieres producir por minuto.", "results.locateChanged": "Localizar cambios",
        "results.noPlan": "No se puede mostrar un plan de producción con las condiciones actuales.", "results.noTarget": "Aún no se ha calculado ningún objetivo de producción.",
        "status.addTarget": "Añade al menos un material objetivo e introduce una cantidad por minuto.", "status.calculating": "Solicitando el cálculo al servidor…",
        "status.connectionFailed": "No se pudo conectar con el servicio del planificador de producción", "status.invalidRate": "Introduce una cantidad positiva por minuto para {name}.",
        "status.itemsLoading": "{count} materiales listos · Cargando el catálogo de recetas…", "status.itemsReady": "Los materiales están listos. Puedes elegir objetivos mientras se cargan las recetas.",
        "status.loadingRecipes": "El catálogo de recetas aún se está cargando. Espera antes de calcular.",
        "status.optimized": "{targets} objetivo(s) optimizado(s), {recipes} receta(s) utilizada(s), {selected} receta(s) seleccionada(s), entrada externa {external} /min, agrupadas en {rows} fila(s) de material.",
        "status.saved": "Plan objetivo guardado: {plan}.", "status.scaled": "Resultado actual multiplicado por {factor} sin volver a solicitarlo al servidor.",
        "status.unmatched": "No se ha encontrado el material: {name}", "summary.loaded": "{recipes} recetas · {items} materiales · {raw} recursos en bruto",
        "targets.chooseTarget": "Elegir material objetivo", "targets.chooseTargetHelp": "Elige el material que debe producir la fábrica.",
        "targets.noSaved": "No hay planes guardados", "targets.remove": "Quitar material",
    },
    "ja-JP": {
        "app.title": "Satisfactory 生産プランナー", "app.connecting": "生産プランナーサービスに接続しています…",
        "calculating.message": "生産プランを計算しています。しばらくお待ちください。", "calculating.title": "生産プランを計算中…",
        "category.NormalMaterial": "製造アイテム", "category.PickupMaterial": "収集アイテム", "category.Power": "電力", "category.RawMaterial": "原材料",
        "focus.enterBrowser": "ブラウザーを全画面表示", "focus.enterPage": "結果表示を拡大", "focus.exit": "全画面表示を終了",
        "info.title": "プラン情報", "kind.alternateRecipe": "代替レシピ", "kind.output": "出力", "kind.recipe": "レシピ", "kind.surplus": "余剰",
        "picker.categories": "素材カテゴリ", "picker.close": "素材選択を閉じる", "picker.count.one": "{count} 個の素材", "picker.count.other": "{count} 個の素材",
        "picker.empty": "一致する素材はありません。", "picker.help": "カテゴリを選択してから素材を選択してください。", "picker.materials": "素材",
        "picker.searchAria": "素材を検索", "picker.select": "{name}を選択", "picker.tier": "ティア {tier}", "picker.title": "素材を選択",
        "recipes.baseTag": "[基本レシピ]", "recipes.chooseSearchHelp": "素材を選択すると、その素材で使用できるレシピだけを表示します。",
        "recipes.chooseSearchMaterial": "レシピ検索用の素材を選択", "recipes.directRaw": "{name}を原材料として直接使用",
        "recipes.directRawName": "{name}を直接使用", "recipes.hint": "同じレシピが複数の素材に表示される場合があります。どこか1か所を切り替えると、すべてに反映されます。",
        "recipes.material": "素材：{name}", "recipes.none": "一致するレシピはありません。", "recipes.recipeTag": "[レシピ]", "recipes.required": "必要なレシピ",
        "recipes.search": "素材またはレシピを検索", "recipes.searchRequired": "必要なレシピを検索",
        "results.compactExitHint": "空白部分をクリックして戻る", "results.compactFocus": "このレシピにフォーカス", "results.findRecipe": "レシピを検索",
        "results.findRecipeChooseMaterial": "素材を選択", "results.findRecipeCount": "一致するレシピ：{count}件",
        "results.findRecipeMaterial": "現在のプランから素材を選択", "results.findRecipeMaterialHelp": "出力素材を選択すると、このプラン内の該当レシピだけを表示します。",
        "results.findRecipeNone": "現在のプランに一致するレシピはありません。", "results.findRecipeSearch": "レシピまたは出力素材を検索",
        "results.initial": "素材を1つ以上選択し、毎分の生産量を入力してください。", "results.locateChanged": "変更箇所を検索",
        "results.noPlan": "現在の条件では生産プランを表示できません。", "results.noTarget": "生産目標はまだ計算されていません。",
        "status.addTarget": "目標素材を1つ以上追加し、毎分の生産量を入力してください。", "status.calculating": "サーバーに計算をリクエストしています…",
        "status.connectionFailed": "生産プランナーサービスに接続できません", "status.invalidRate": "{name}の毎分生産量に正の数を入力してください。",
        "status.itemsLoading": "素材{count}件の準備完了 · レシピ一覧を読み込み中…", "status.itemsReady": "素材の準備ができました。レシピの読み込み中も目標を選択できます。",
        "status.loadingRecipes": "レシピ一覧を読み込み中です。計算を始める前にお待ちください。",
        "status.optimized": "目標{targets}件を最適化、使用レシピ{recipes}件、選択レシピ{selected}件、外部入力{external}/分、素材行{rows}件に集約しました。",
        "status.saved": "目標プランを保存しました：{plan}。", "status.scaled": "サーバーに再リクエストせず、現在の結果を{factor}倍しました。",
        "status.unmatched": "素材が見つかりません：{name}", "summary.loaded": "レシピ{recipes}件 · 素材{items}件 · 原材料{raw}種",
        "targets.chooseTarget": "目標素材を選択", "targets.chooseTargetHelp": "工場で生産する素材を選択してください。",
        "targets.noSaved": "保存済みプランはありません", "targets.remove": "素材を削除",
    },
    "ko-KR": {
        "app.title": "Satisfactory 생산 플래너", "app.connecting": "생산 플래너 서비스에 연결하는 중…", "calculating.message": "생산 계획을 계산하고 있습니다. 잠시 기다려 주세요.", "calculating.title": "생산 계획 계산 중…",
        "category.NormalMaterial": "제작 아이템", "category.PickupMaterial": "수집 아이템", "category.Power": "전력", "category.RawMaterial": "원재료",
        "focus.enterBrowser": "브라우저 전체 화면", "focus.enterPage": "결과 보기 확장", "focus.exit": "전체 화면 보기 종료", "focus.switchToPage": "페이지 전체 화면으로 전환", "info.title": "계획 정보", "kind.alternateRecipe": "대체 제작법", "kind.output": "생산", "kind.recipe": "제작법", "kind.surplus": "잉여",
        "picker.categories": "재료 분류", "picker.close": "재료 선택 창 닫기", "picker.count.one": "재료 {count}개", "picker.count.other": "재료 {count}개", "picker.empty": "검색 결과와 일치하는 재료가 없습니다.", "picker.help": "분류를 선택한 다음 재료를 선택하세요.", "picker.materials": "재료", "picker.searchAria": "재료 검색", "picker.select": "{name} 선택", "picker.tier": "티어 {tier}", "picker.title": "재료 선택",
        "recipes.baseTag": "[기본 제작법]", "recipes.chooseSearchHelp": "재료를 선택하면 사용 가능한 제작법만 표시됩니다.", "recipes.chooseSearchMaterial": "제작법 검색 재료 선택", "recipes.directRaw": "{name}을(를) 원재료로 직접 사용", "recipes.directRawName": "{name} 직접 사용", "recipes.hint": "같은 제작법이 여러 재료 아래에 표시될 수 있습니다. 한 곳에서 선택하면 모든 항목에 반영됩니다.", "recipes.material": "재료: {name}", "recipes.none": "일치하는 제작법이 없습니다.", "recipes.recipeTag": "[제작법]", "recipes.required": "필요한 제작법", "recipes.search": "재료 또는 제작법 검색", "recipes.searchRequired": "필요한 제작법 검색",
        "results.compactExitHint": "빈 공간을 클릭하면 돌아갑니다", "results.compactFocus": "이 제작법에 초점 맞추기", "results.compactUpstream": "상류", "results.compactCurrent": "집중 중인 제작법", "results.compactDownstream": "하류", "results.findRecipe": "제작법 찾기", "results.findRecipeChooseMaterial": "재료 선택", "results.findRecipeCount": "일치하는 제작법 {count}개", "results.findRecipeMaterial": "현재 계획에서 재료 선택", "results.findRecipeMaterialHelp": "생산된 재료를 선택하면 이 계획에서 해당 제작법만 표시됩니다.", "results.findRecipeNone": "현재 계획에 일치하는 제작법이 없습니다.", "results.findRecipeSearch": "제작법 또는 생산 재료 검색", "results.initial": "재료를 하나 이상 선택하고 분당 생산량을 입력하세요.", "results.locateChanged": "변경 사항 찾기", "results.noPlan": "현재 조건으로 생산 계획을 표시할 수 없습니다.", "results.noTarget": "아직 생산 목표를 계산하지 않았습니다.",
        "status.addTarget": "목표 재료를 하나 이상 추가하고 분당 생산량을 입력하세요.", "status.calculating": "서버에 계산을 요청하는 중…", "status.connectionFailed": "생산 플래너 서비스에 연결할 수 없습니다", "status.invalidRate": "{name}의 분당 생산량에 양수를 입력하세요.", "status.itemsLoading": "재료 {count}개 준비 완료 · 제작법 목록을 불러오는 중…", "status.itemsReady": "재료가 준비되었습니다. 제작법을 불러오는 동안 목표를 선택할 수 있습니다.", "status.loadingRecipes": "제작법 목록을 불러오는 중입니다. 계산하기 전에 잠시 기다려 주세요.", "status.optimized": "목표 {targets}개 최적화, 사용 제작법 {recipes}개, 선택 제작법 {selected}개, 외부 입력 {external}/분, 재료 행 {rows}개로 통합했습니다.", "status.saved": "목표 계획을 저장했습니다: {plan}.", "status.scaled": "서버에 다시 요청하지 않고 현재 결과를 {factor}배로 조정했습니다.", "status.unmatched": "재료를 찾을 수 없습니다: {name}", "summary.loaded": "제작법 {recipes}개 · 재료 {items}개 · 원재료 {raw}종",
        "targets.chooseTarget": "목표 재료 선택", "targets.chooseTargetHelp": "공장에서 생산할 재료를 선택하세요.", "targets.noSaved": "저장된 계획이 없습니다", "targets.remove": "재료 제거",
    },
    "pl-PL": {
        "app.title": "Planer produkcji Satisfactory", "app.connecting": "Łączenie z usługą planera produkcji…", "calculating.message": "Trwa obliczanie planu produkcji. Proszę czekać.", "calculating.title": "Obliczanie planu produkcji…",
        "category.NormalMaterial": "Wytwarzany przedmiot", "category.PickupMaterial": "Przedmiot do zebrania", "category.Power": "Energia", "category.RawMaterial": "Surowiec",
        "focus.enterBrowser": "Pełny ekran przeglądarki", "focus.enterPage": "Rozszerz widok wyników", "focus.exit": "Zamknij widok pełnoekranowy", "focus.switchToPage": "Przełącz na pełny ekran strony", "info.title": "Informacje o planie", "kind.alternateRecipe": "Alternatywna receptura", "kind.output": "Produkcja", "kind.recipe": "Receptura", "kind.surplus": "Nadwyżka",
        "picker.categories": "Kategorie materiałów", "picker.close": "Zamknij wybór materiału", "picker.count.one": "{count} materiał", "picker.count.other": "{count} materiałów", "picker.empty": "Brak materiałów pasujących do wyszukiwania.", "picker.help": "Wybierz kategorię, a następnie materiał.", "picker.materials": "Materiały", "picker.searchAria": "Szukaj materiałów", "picker.select": "Wybierz {name}", "picker.tier": "Poziom {tier}", "picker.title": "Wybierz materiał",
        "recipes.baseTag": "[Podstawowa receptura]", "recipes.chooseSearchHelp": "Wybierz materiał, aby wyświetlić tylko dostępne dla niego receptury.", "recipes.chooseSearchMaterial": "Wybierz materiał do wyszukania receptur", "recipes.directRaw": "Użyj {name} bezpośrednio jako surowca", "recipes.directRawName": "Użyj {name} bezpośrednio", "recipes.hint": "Ta sama receptura może występować przy wielu materiałach; zaznaczenie jej w jednym miejscu aktualizuje wszystkie wystąpienia.", "recipes.material": "Materiał: {name}", "recipes.none": "Brak pasujących receptur.", "recipes.recipeTag": "[Receptura]", "recipes.required": "Wymagane receptury", "recipes.search": "Szukaj materiałów lub receptur", "recipes.searchRequired": "Szukaj wymaganych receptur",
        "results.compactExitHint": "Kliknij puste miejsce, aby wrócić", "results.compactFocus": "Skup widok na tej recepturze", "results.compactUpstream": "Poprzedzające", "results.compactCurrent": "Wybrana receptura", "results.compactDownstream": "Następujące", "results.findRecipe": "Znajdź recepturę", "results.findRecipeChooseMaterial": "Wybierz materiał", "results.findRecipeCount": "Pasujące receptury: {count}", "results.findRecipeMaterial": "Wybierz materiał z bieżącego planu", "results.findRecipeMaterialHelp": "Wybierz produkowany materiał, aby wyświetlić tylko jego receptury w tym planie.", "results.findRecipeNone": "Brak pasujących receptur w bieżącym planie.", "results.findRecipeSearch": "Szukaj receptur lub wytwarzanych materiałów", "results.initial": "Wybierz co najmniej jeden materiał i podaj wymaganą produkcję na minutę.", "results.locateChanged": "Znajdź zmiany", "results.noPlan": "Nie można wyświetlić planu produkcji dla bieżących warunków.", "results.noTarget": "Nie obliczono jeszcze celu produkcji.",
        "status.addTarget": "Dodaj co najmniej jeden materiał docelowy i podaj ilość na minutę.", "status.calculating": "Wysyłanie żądania obliczeń do serwera…", "status.connectionFailed": "Nie można połączyć się z usługą planera produkcji", "status.invalidRate": "Podaj dodatnią produkcję na minutę dla materiału {name}.", "status.itemsLoading": "Gotowe materiały: {count} · Wczytywanie katalogu receptur…", "status.itemsReady": "Materiały są gotowe. Możesz wybierać cele podczas wczytywania receptur.", "status.loadingRecipes": "Katalog receptur nadal się wczytuje. Poczekaj chwilę przed obliczeniami.", "status.optimized": "Zoptymalizowano cele: {targets}, użyte receptury: {recipes}, wybrane receptury: {selected}, wejście zewnętrzne {external}/min, połączone wiersze materiałów: {rows}.", "status.saved": "Zapisano plan celu: {plan}.", "status.scaled": "Przeskalowano bieżący wynik {factor}× bez ponownego żądania do serwera.", "status.unmatched": "Nie znaleziono materiału: {name}", "summary.loaded": "Receptury: {recipes} · materiały: {items} · surowce: {raw}",
        "targets.chooseTarget": "Wybierz materiał docelowy", "targets.chooseTargetHelp": "Wybierz materiał, który ma wytwarzać fabryka.", "targets.noSaved": "Brak zapisanych planów", "targets.remove": "Usuń materiał",
    },
    "pt-BR": {
        "app.title": "Planejador de produção de Satisfactory", "app.connecting": "Conectando ao serviço do planejador de produção…", "calculating.message": "Calculando o plano de produção. Aguarde.", "calculating.title": "Calculando o plano de produção…",
        "category.NormalMaterial": "Item fabricado", "category.PickupMaterial": "Item coletável", "category.Power": "Energia", "category.RawMaterial": "Recurso bruto",
        "focus.enterBrowser": "Tela cheia do navegador", "focus.enterPage": "Expandir visualização dos resultados", "focus.exit": "Sair da tela cheia", "focus.switchToPage": "Alternar para tela cheia da página", "info.title": "Informações do plano", "kind.alternateRecipe": "Receita alternativa", "kind.output": "Produção", "kind.recipe": "Receita", "kind.surplus": "Excedente",
        "picker.categories": "Categorias de materiais", "picker.close": "Fechar seletor de materiais", "picker.count.one": "{count} material", "picker.count.other": "{count} materiais", "picker.empty": "Nenhum material corresponde à busca.", "picker.help": "Escolha uma categoria e depois um material.", "picker.materials": "Materiais", "picker.searchAria": "Buscar materiais", "picker.select": "Selecionar {name}", "picker.tier": "Nível {tier}", "picker.title": "Escolher material",
        "recipes.baseTag": "[Receita básica]", "recipes.chooseSearchHelp": "Escolha um material para exibir apenas as receitas disponíveis para ele.", "recipes.chooseSearchMaterial": "Escolher material para buscar receitas", "recipes.directRaw": "Usar {name} diretamente como recurso bruto", "recipes.directRawName": "Usar {name} diretamente", "recipes.hint": "A mesma receita pode aparecer em vários materiais; selecioná-la em uma linha atualiza todas as ocorrências.", "recipes.material": "Material: {name}", "recipes.none": "Nenhuma receita correspondente.", "recipes.recipeTag": "[Receita]", "recipes.required": "Receitas necessárias", "recipes.search": "Buscar materiais ou receitas", "recipes.searchRequired": "Buscar receitas necessárias",
        "results.compactExitHint": "Clique em uma área vazia para voltar", "results.compactFocus": "Focar nesta receita", "results.compactUpstream": "A montante", "results.compactCurrent": "Receita em foco", "results.compactDownstream": "A jusante", "results.findRecipe": "Encontrar receita", "results.findRecipeChooseMaterial": "Escolher material", "results.findRecipeCount": "{count} receita(s) correspondente(s)", "results.findRecipeMaterial": "Escolher material do plano atual", "results.findRecipeMaterialHelp": "Escolha um material produzido para exibir apenas as receitas dele neste plano.", "results.findRecipeNone": "Nenhuma receita correspondente no plano atual.", "results.findRecipeSearch": "Buscar receitas ou materiais produzidos", "results.initial": "Selecione um ou mais materiais e informe a quantidade a produzir por minuto.", "results.locateChanged": "Localizar alterações", "results.noPlan": "Não é possível exibir um plano de produção com as condições atuais.", "results.noTarget": "Nenhuma meta de produção foi calculada ainda.",
        "status.addTarget": "Adicione pelo menos um material-alvo e informe uma quantidade por minuto.", "status.calculating": "Solicitando o cálculo ao servidor…", "status.connectionFailed": "Não foi possível conectar ao serviço do planejador de produção", "status.invalidRate": "Informe uma taxa positiva por minuto para {name}.", "status.itemsLoading": "{count} materiais prontos · Carregando o catálogo de receitas…", "status.itemsReady": "Os materiais estão prontos. Você pode escolher metas enquanto as receitas carregam.", "status.loadingRecipes": "O catálogo de receitas ainda está carregando. Aguarde antes de calcular.", "status.optimized": "Metas otimizadas: {targets}; receitas usadas: {recipes}; receitas selecionadas: {selected}; entrada externa: {external}/min; linhas de materiais: {rows}.", "status.saved": "Plano de metas salvo: {plan}.", "status.scaled": "Resultado atual multiplicado por {factor}, sem solicitar novamente ao servidor.", "status.unmatched": "Não foi possível encontrar o material: {name}", "summary.loaded": "{recipes} receitas · {items} materiais · {raw} recursos brutos",
        "targets.chooseTarget": "Escolher material-alvo", "targets.chooseTargetHelp": "Escolha o material que a fábrica deve produzir.", "targets.noSaved": "Nenhum plano salvo", "targets.remove": "Remover material",
    },
    "ru-RU": {
        "app.title": "Планировщик производства Satisfactory", "app.connecting": "Подключение к сервису планирования производства…", "calculating.message": "Выполняется расчёт производственного плана. Подождите.", "calculating.title": "Расчёт производственного плана…",
        "category.NormalMaterial": "Производимый предмет", "category.PickupMaterial": "Собираемый предмет", "category.Power": "Энергия", "category.RawMaterial": "Сырьё",
        "focus.enterBrowser": "Полноэкранный режим браузера", "focus.enterPage": "Развернуть результаты", "focus.exit": "Выйти из полноэкранного режима", "focus.switchToPage": "Переключить на полноэкранный режим страницы", "info.title": "Информация о плане", "kind.alternateRecipe": "Альтернативный рецепт", "kind.output": "Выход", "kind.recipe": "Рецепт", "kind.surplus": "Избыток",
        "picker.categories": "Категории материалов", "picker.close": "Закрыть выбор материала", "picker.count.one": "Материалов: {count}", "picker.count.other": "Материалов: {count}", "picker.empty": "Материалы по запросу не найдены.", "picker.help": "Выберите категорию, затем материал.", "picker.materials": "Материалы", "picker.searchAria": "Поиск материалов", "picker.select": "Выбрать {name}", "picker.tier": "Уровень {tier}", "picker.title": "Выберите материал",
        "recipes.baseTag": "[Базовый рецепт]", "recipes.chooseSearchHelp": "Выберите материал, чтобы видеть только доступные для него рецепты.", "recipes.chooseSearchMaterial": "Выберите материал для поиска рецептов", "recipes.directRaw": "Использовать {name} напрямую как сырьё", "recipes.directRawName": "Использовать {name} напрямую", "recipes.hint": "Один рецепт может отображаться у нескольких материалов; изменение в одном месте обновляет все копии.", "recipes.material": "Материал: {name}", "recipes.none": "Подходящие рецепты не найдены.", "recipes.recipeTag": "[Рецепт]", "recipes.required": "Требуемые рецепты", "recipes.search": "Поиск материалов или рецептов", "recipes.searchRequired": "Поиск требуемых рецептов",
        "results.compactExitHint": "Нажмите на пустое место, чтобы вернуться", "results.compactFocus": "Сфокусироваться на этом рецепте", "results.compactUpstream": "Входящие", "results.compactCurrent": "Выбранный рецепт", "results.compactDownstream": "Исходящие", "results.findRecipe": "Найти рецепт", "results.findRecipeChooseMaterial": "Выбрать материал", "results.findRecipeCount": "Подходящих рецептов: {count}", "results.findRecipeMaterial": "Выбрать материал из текущего плана", "results.findRecipeMaterialHelp": "Выберите производимый материал, чтобы видеть только его рецепты в этом плане.", "results.findRecipeNone": "В текущем плане подходящие рецепты не найдены.", "results.findRecipeSearch": "Поиск рецептов или производимых материалов", "results.initial": "Выберите один или несколько материалов и укажите выпуск в минуту.", "results.locateChanged": "Найти изменения", "results.noPlan": "Не удалось отобразить производственный план для текущих условий.", "results.noTarget": "Цель производства ещё не рассчитана.",
        "status.addTarget": "Добавьте хотя бы один целевой материал и укажите выпуск в минуту.", "status.calculating": "Отправка запроса на расчёт серверу…", "status.connectionFailed": "Не удалось подключиться к сервису планирования производства", "status.invalidRate": "Укажите положительный выпуск в минуту для материала {name}.", "status.itemsLoading": "Материалы готовы: {count} · Загрузка каталога рецептов…", "status.itemsReady": "Материалы готовы. Можно выбирать цели, пока загружаются рецепты.", "status.loadingRecipes": "Каталог рецептов ещё загружается. Подождите перед расчётом.", "status.optimized": "Оптимизировано целей: {targets}; использовано рецептов: {recipes}; выбрано рецептов: {selected}; внешний ввод: {external}/мин; строк материалов: {rows}.", "status.saved": "Целевой план сохранён: {plan}.", "status.scaled": "Текущий результат умножен на {factor} без повторного запроса серверу.", "status.unmatched": "Материал не найден: {name}", "summary.loaded": "Рецепты: {recipes} · материалы: {items} · сырьё: {raw}",
        "targets.chooseTarget": "Выбрать целевой материал", "targets.chooseTargetHelp": "Выберите материал, который должна производить фабрика.", "targets.noSaved": "Нет сохранённых планов", "targets.remove": "Удалить материал",
    },
    "uk-UA": {
        "app.title": "Планувальник виробництва Satisfactory", "app.connecting": "Підключення до сервісу планування виробництва…", "calculating.message": "Обчислюється план виробництва. Зачекайте.", "calculating.title": "Обчислення плану виробництва…",
        "category.NormalMaterial": "Виготовлений предмет", "category.PickupMaterial": "Предмет для збирання", "category.Power": "Енергія", "category.RawMaterial": "Сировина",
        "focus.enterBrowser": "Повноекранний режим браузера", "focus.enterPage": "Розгорнути результати", "focus.exit": "Вийти з повноекранного режиму", "focus.switchToPage": "Перейти до повноекранного режиму сторінки", "info.title": "Відомості про план", "kind.alternateRecipe": "Альтернативний рецепт", "kind.output": "Вихід", "kind.recipe": "Рецепт", "kind.surplus": "Надлишок",
        "picker.categories": "Категорії матеріалів", "picker.close": "Закрити вибір матеріалу", "picker.count.one": "Матеріалів: {count}", "picker.count.other": "Матеріалів: {count}", "picker.empty": "Матеріалів за запитом не знайдено.", "picker.help": "Виберіть категорію, а потім матеріал.", "picker.materials": "Матеріали", "picker.searchAria": "Шукати матеріали", "picker.select": "Вибрати {name}", "picker.tier": "Рівень {tier}", "picker.title": "Виберіть матеріал",
        "recipes.baseTag": "[Базовий рецепт]", "recipes.chooseSearchHelp": "Виберіть матеріал, щоб показати лише доступні для нього рецепти.", "recipes.chooseSearchMaterial": "Виберіть матеріал для пошуку рецептів", "recipes.directRaw": "Використовувати {name} безпосередньо як сировину", "recipes.directRawName": "Використовувати {name} безпосередньо", "recipes.hint": "Один рецепт може відображатися для кількох матеріалів; зміна в одному місці оновлює всі копії.", "recipes.material": "Матеріал: {name}", "recipes.none": "Відповідних рецептів не знайдено.", "recipes.recipeTag": "[Рецепт]", "recipes.required": "Потрібні рецепти", "recipes.search": "Пошук матеріалів або рецептів", "recipes.searchRequired": "Пошук потрібних рецептів",
        "results.compactExitHint": "Натисніть на порожнє місце, щоб повернутися", "results.compactFocus": "Зосередитися на цьому рецепті", "results.compactUpstream": "Попередні", "results.compactCurrent": "Вибраний рецепт", "results.compactDownstream": "Наступні", "results.findRecipe": "Знайти рецепт", "results.findRecipeChooseMaterial": "Вибрати матеріал", "results.findRecipeCount": "Відповідних рецептів: {count}", "results.findRecipeMaterial": "Вибрати матеріал із поточного плану", "results.findRecipeMaterialHelp": "Виберіть вироблений матеріал, щоб показати лише його рецепти в цьому плані.", "results.findRecipeNone": "У поточному плані відповідних рецептів не знайдено.", "results.findRecipeSearch": "Пошук рецептів або вироблених матеріалів", "results.initial": "Виберіть один або кілька матеріалів і вкажіть кількість виробництва за хвилину.", "results.locateChanged": "Знайти зміни", "results.noPlan": "Не вдалося показати план виробництва для поточних умов.", "results.noTarget": "Ціль виробництва ще не обчислено.",
        "status.addTarget": "Додайте принаймні один цільовий матеріал і вкажіть кількість за хвилину.", "status.calculating": "Надсилання запиту на обчислення серверу…", "status.connectionFailed": "Не вдалося підключитися до сервісу планування виробництва", "status.invalidRate": "Вкажіть додатну кількість виробництва за хвилину для {name}.", "status.itemsLoading": "Матеріали готові: {count} · Завантаження каталогу рецептів…", "status.itemsReady": "Матеріали готові. Можна вибирати цілі, поки завантажуються рецепти.", "status.loadingRecipes": "Каталог рецептів ще завантажується. Зачекайте перед обчисленням.", "status.optimized": "Оптимізовано цілей: {targets}; використано рецептів: {recipes}; вибрано рецептів: {selected}; зовнішній ввід: {external}/хв; рядків матеріалів: {rows}.", "status.saved": "Цільовий план збережено: {plan}.", "status.scaled": "Поточний результат помножено на {factor} без повторного запиту до сервера.", "status.unmatched": "Матеріал не знайдено: {name}", "summary.loaded": "Рецепти: {recipes} · матеріали: {items} · сировина: {raw}",
        "targets.chooseTarget": "Вибрати цільовий матеріал", "targets.chooseTargetHelp": "Виберіть матеріал, який має виробляти фабрика.", "targets.noSaved": "Збережених планів немає", "targets.remove": "Видалити матеріал",
    },
}

LIVE_UI_EXTRA = {
    "fr-FR": {"focus.switchToPage": "Passer en plein écran de la page", "results.compactUpstream": "Amont", "results.compactCurrent": "Recette ciblée", "results.compactDownstream": "Aval", "status.loaded": "Les données de recettes sont chargées. Choisissez des matériaux et indiquez leur débit par minute."},
    "it-IT": {"focus.switchToPage": "Passa allo schermo intero della pagina", "results.compactUpstream": "A monte", "results.compactCurrent": "Ricetta selezionata", "results.compactDownstream": "A valle", "status.loaded": "I dati delle ricette sono caricati. Scegli i materiali e inserisci le quantità al minuto."},
    "de-DE": {"focus.switchToPage": "Zum Vollbild der Seite wechseln", "results.compactUpstream": "Vorgelagert", "results.compactCurrent": "Fokussiertes Rezept", "results.compactDownstream": "Nachgelagert", "status.loaded": "Rezeptdaten geladen. Wähle Materialien und gib die Menge pro Minute ein."},
    "es-ES": {"focus.switchToPage": "Cambiar a pantalla completa de la página", "results.compactUpstream": "Aguas arriba", "results.compactCurrent": "Receta enfocada", "results.compactDownstream": "Aguas abajo", "status.loaded": "Se han cargado los datos de recetas. Elige materiales e introduce las cantidades por minuto."},
    "ja-JP": {"focus.switchToPage": "ページ全体を全画面表示", "results.compactUpstream": "上流", "results.compactCurrent": "注目中のレシピ", "results.compactDownstream": "下流", "status.loaded": "レシピデータを読み込みました。素材を選択し、毎分の生産量を入力してください。"},
    "ko-KR": {"status.loaded": "제작법 데이터를 불러왔습니다. 재료를 선택하고 분당 생산량을 입력하세요."},
    "pl-PL": {"status.loaded": "Wczytano dane receptur. Wybierz materiały i podaj ilość produkcji na minutę."},
    "pt-BR": {"status.loaded": "Os dados das receitas foram carregados. Escolha os materiais e informe as quantidades por minuto."},
    "ru-RU": {"status.loaded": "Данные рецептов загружены. Выберите материалы и укажите выпуск в минуту."},
    "uk-UA": {"status.loaded": "Дані рецептів завантажено. Виберіть матеріали та вкажіть кількість виробництва за хвилину."},
    "zh-CN": {"focus.enterBrowser": "浏览器全屏", "focus.enterPage": "展开结果视图", "focus.exit": "退出全屏视图", "focus.switchToPage": "切换到页面全屏", "info.title": "方案信息", "recipes.material": "材料：{name}", "results.compactExitHint": "点击空白处返回", "results.compactFocus": "聚焦此配方", "results.compactUpstream": "上游", "results.compactCurrent": "当前配方", "results.compactDownstream": "下游"},
    "zh-TW": {
        "focus.enterBrowser": "瀏覽器全螢幕", "focus.enterPage": "展開結果檢視", "focus.exit": "退出全螢幕檢視", "focus.switchToPage": "切換至頁面全螢幕", "info.title": "方案資訊",
        "picker.categories": "材料分類", "picker.close": "關閉材料選擇器", "picker.materials": "材料", "picker.searchAria": "搜尋材料", "picker.tier": "階級 {tier}", "picker.count.one": "{count} 種材料", "picker.count.other": "{count} 種材料",
        "recipes.chooseSearchHelp": "選擇材料後，只顯示該材料可用的配方。", "recipes.chooseSearchMaterial": "選擇要搜尋配方的材料", "recipes.directRaw": "直接將 {name} 作為原始資源使用", "recipes.hint": "同一配方可能出現在多種材料下；在任一處勾選都會同步更新所有項目。", "recipes.material": "材料：{name}", "recipes.none": "沒有符合的配方。", "recipes.required": "所需配方", "recipes.search": "搜尋材料或配方", "recipes.searchRequired": "搜尋所需配方",
        "results.compactExitHint": "點擊空白處返回", "results.compactFocus": "聚焦此配方", "results.compactUpstream": "上游", "results.compactCurrent": "目前配方", "results.compactDownstream": "下游", "results.noPlan": "目前條件下無法顯示生產方案。", "results.noTarget": "尚未計算生產目標。",
        "status.addTarget": "請至少新增一個目標材料，並輸入每分鐘產量。", "status.calculating": "正在向伺服器請求計算…", "status.connectionFailed": "無法連線至生產規劃服務", "status.invalidRate": "請輸入 {name} 每分鐘的正數產量。", "status.itemsLoading": "已準備 {count} 種材料 · 正在載入配方目錄…", "status.itemsReady": "材料已就緒。載入配方時仍可選擇目標。", "status.loaded": "配方資料已載入。請選擇材料並輸入每分鐘產量。", "status.loadingRecipes": "配方目錄仍在載入，請稍候再計算。", "status.optimized": "已最佳化 {targets} 個目標，使用 {recipes} 個配方，選取 {selected} 個配方，外部輸入 {external}/分鐘，合併為 {rows} 列材料。", "status.saved": "已儲存目標方案：{plan}。", "status.scaled": "目前結果已縮放 {factor} 倍，未再次向伺服器請求。", "status.unmatched": "找不到材料：{name}", "summary.loaded": "{recipes} 個配方 · {items} 種材料 · {raw} 種原始資源", "targets.noSaved": "沒有已儲存方案", "targets.remove": "移除材料",
    },
}

LIVE_UI_HARDCODE_COPY = {
    "fr-FR": {"status.loadFailed":"Impossible de charger les données. Veuillez réessayer.","status.calcFailed":"Échec du calcul. Identifiant du problème : {issue}.","status.expansionFailed":"La sélection actuelle ne permet pas de produire les objectifs. Des recettes requises ont été ajoutées ; relancez le calcul.","recipes.expansionNotice":"Les recettes requises ont été sélectionnées automatiquement.","results.expansionEmpty":"Le filtre de recettes est ouvert et les recettes manquantes ont été sélectionnées. Relancez le calcul.","recipes.filterOpen":"Ouvrir le filtre de recettes","recipes.showForMaterial":"Afficher les recettes de {name}","graph.checkTitle":"Marquer {type} comme vérifié","graph.checkAria":"Marquer {name} comme vérifié","graph.building":"Bâtiment de production","graph.material":"Matériau","graph.dragFilter":"Déplacer le panneau de filtre de recettes","common.unknown":"Inconnu","common.none":"Aucun","recipes.count":"{count} recette(s)","recipes.primary":"principal","recipes.byproduct":"sous-produit","recipes.base":"de base","recipes.alternate":"alternatif","recipes.additional":"supplémentaire","recipes.rawSource":"source brute"},
    "it-IT": {"status.loadFailed":"Impossibile caricare i dati. Riprova.","status.calcFailed":"Calcolo non riuscito. ID problema: {issue}.","status.expansionFailed":"La selezione attuale non può produrre gli obiettivi. Sono state aggiunte le ricette necessarie; calcola di nuovo.","recipes.expansionNotice":"Le ricette necessarie sono state selezionate automaticamente.","results.expansionEmpty":"Il filtro ricette è aperto e le ricette mancanti sono state selezionate. Calcola di nuovo.","recipes.filterOpen":"Apri il filtro ricette","recipes.showForMaterial":"Mostra le ricette per {name}","graph.checkTitle":"Segna {type} come verificato","graph.checkAria":"Segna {name} come verificato","graph.building":"Edificio di produzione","graph.material":"Materiale","graph.dragFilter":"Sposta il pannello del filtro ricette","common.unknown":"Sconosciuto","common.none":"Nessuno","recipes.count":"{count} ricetta/e","recipes.primary":"principale","recipes.byproduct":"sottoprodotto","recipes.base":"base","recipes.alternate":"alternativa","recipes.additional":"aggiuntiva","recipes.rawSource":"fonte grezza"},
    "de-DE": {"status.loadFailed":"Daten konnten nicht geladen werden. Bitte versuche es erneut.","status.calcFailed":"Berechnung fehlgeschlagen. Problem-ID: {issue}.","status.expansionFailed":"Mit der aktuellen Auswahl können die Ziele nicht produziert werden. Erforderliche Rezepte wurden hinzugefügt; bitte erneut berechnen.","recipes.expansionNotice":"Die erforderlichen Rezepte wurden automatisch ausgewählt.","results.expansionEmpty":"Der Rezeptfilter ist geöffnet und die fehlenden Rezepte wurden ausgewählt. Bitte erneut berechnen.","recipes.filterOpen":"Rezeptfilter öffnen","recipes.showForMaterial":"Rezepte für {name} anzeigen","graph.checkTitle":"{type} als geprüft markieren","graph.checkAria":"{name} als geprüft markieren","graph.building":"Produktionsgebäude","graph.material":"Material","graph.dragFilter":"Rezeptfilter-Panel verschieben","common.unknown":"Unbekannt","common.none":"Keine","recipes.count":"{count} Rezept(e)","recipes.primary":"Hauptprodukt","recipes.byproduct":"Nebenprodukt","recipes.base":"Basis","recipes.alternate":"Alternative","recipes.additional":"Zusätzlich","recipes.rawSource":"Rohstoffquelle"},
    "es-ES": {"status.loadFailed":"No se pudieron cargar los datos. Inténtalo de nuevo.","status.calcFailed":"No se pudo calcular. ID del problema: {issue}.","status.expansionFailed":"La selección actual no permite producir los objetivos. Se han añadido las recetas necesarias; vuelve a calcular.","recipes.expansionNotice":"Las recetas necesarias se han seleccionado automáticamente.","results.expansionEmpty":"El filtro de recetas está abierto y se han seleccionado las recetas que faltaban. Vuelve a calcular.","recipes.filterOpen":"Abrir filtro de recetas","recipes.showForMaterial":"Mostrar recetas de {name}","graph.checkTitle":"Marcar {type} como comprobado","graph.checkAria":"Marcar {name} como comprobado","graph.building":"Edificio de producción","graph.material":"Material","graph.dragFilter":"Mover el panel del filtro de recetas","common.unknown":"Desconocido","common.none":"Ninguno","recipes.count":"{count} receta(s)","recipes.primary":"principal","recipes.byproduct":"subproducto","recipes.base":"básica","recipes.alternate":"alternativa","recipes.additional":"adicional","recipes.rawSource":"recurso en bruto"},
    "ja-JP": {"status.loadFailed":"データを読み込めませんでした。もう一度お試しください。","status.calcFailed":"計算に失敗しました。問題 ID：{issue}。","status.expansionFailed":"現在の選択では目標を生産できません。必要なレシピを追加しました。再計算してください。","recipes.expansionNotice":"必要なレシピを自動選択しました。","results.expansionEmpty":"レシピフィルターを開き、不足していたレシピを選択しました。再計算してください。","recipes.filterOpen":"レシピフィルターを開く","recipes.showForMaterial":"{name}のレシピを表示","graph.checkTitle":"{type}を確認済みにする","graph.checkAria":"{name}を確認済みにする","graph.building":"生産施設","graph.material":"素材","graph.dragFilter":"レシピフィルターパネルを移動","common.unknown":"不明","common.none":"なし","recipes.count":"レシピ{count}件","recipes.primary":"主産物","recipes.byproduct":"副産物","recipes.base":"基本","recipes.alternate":"代替","recipes.additional":"追加","recipes.rawSource":"原材料"},
    "ko-KR": {"status.loadFailed":"데이터를 불러오지 못했습니다. 다시 시도하세요.","status.calcFailed":"계산에 실패했습니다. 문제 ID: {issue}.","status.expansionFailed":"현재 선택으로는 목표를 생산할 수 없습니다. 필요한 제작법을 추가했습니다. 다시 계산하세요.","recipes.expansionNotice":"필요한 제작법을 자동으로 선택했습니다.","results.expansionEmpty":"제작법 필터를 열고 누락된 제작법을 선택했습니다. 다시 계산하세요.","recipes.filterOpen":"제작법 필터 열기","recipes.showForMaterial":"{name} 제작법 보기","graph.checkTitle":"{type} 확인 완료로 표시","graph.checkAria":"{name} 확인 완료로 표시","graph.building":"생산 건물","graph.material":"재료","graph.dragFilter":"제작법 필터 패널 이동","common.unknown":"알 수 없음","common.none":"없음","recipes.count":"제작법 {count}개","recipes.primary":"주산물","recipes.byproduct":"부산물","recipes.base":"기본","recipes.alternate":"대체","recipes.additional":"추가","recipes.rawSource":"원재료"},
    "pl-PL": {"status.loadFailed":"Nie udało się wczytać danych. Spróbuj ponownie.","status.calcFailed":"Obliczenia nie powiodły się. Identyfikator problemu: {issue}.","status.expansionFailed":"Bieżący wybór nie pozwala wytworzyć celów. Dodano wymagane receptury; oblicz ponownie.","recipes.expansionNotice":"Wymagane receptury zostały wybrane automatycznie.","results.expansionEmpty":"Filtr receptur jest otwarty, a brakujące receptury zostały zaznaczone. Oblicz ponownie.","recipes.filterOpen":"Otwórz filtr receptur","recipes.showForMaterial":"Pokaż receptury dla: {name}","graph.checkTitle":"Oznacz {type} jako sprawdzone","graph.checkAria":"Oznacz {name} jako sprawdzone","graph.building":"Budynek produkcyjny","graph.material":"Materiał","graph.dragFilter":"Przenieś panel filtra receptur","common.unknown":"Nieznane","common.none":"Brak","recipes.count":"Receptury: {count}","recipes.primary":"główny","recipes.byproduct":"produkt uboczny","recipes.base":"podstawowa","recipes.alternate":"alternatywna","recipes.additional":"dodatkowa","recipes.rawSource":"surowiec"},
    "pt-BR": {"status.loadFailed":"Não foi possível carregar os dados. Tente novamente.","status.calcFailed":"Falha ao calcular. ID do problema: {issue}.","status.expansionFailed":"A seleção atual não produz as metas. As receitas necessárias foram adicionadas; calcule novamente.","recipes.expansionNotice":"As receitas necessárias foram selecionadas automaticamente.","results.expansionEmpty":"O filtro de receitas está aberto e as receitas ausentes foram selecionadas. Calcule novamente.","recipes.filterOpen":"Abrir filtro de receitas","recipes.showForMaterial":"Mostrar receitas de {name}","graph.checkTitle":"Marcar {type} como conferido","graph.checkAria":"Marcar {name} como conferido","graph.building":"Edifício de produção","graph.material":"Material","graph.dragFilter":"Mover painel do filtro de receitas","common.unknown":"Desconhecido","common.none":"Nenhum","recipes.count":"{count} receita(s)","recipes.primary":"principal","recipes.byproduct":"subproduto","recipes.base":"básica","recipes.alternate":"alternativa","recipes.additional":"adicional","recipes.rawSource":"recurso bruto"},
    "ru-RU": {"status.loadFailed":"Не удалось загрузить данные. Повторите попытку.","status.calcFailed":"Не удалось выполнить расчёт. Идентификатор ошибки: {issue}.","status.expansionFailed":"Текущий выбор не позволяет произвести цели. Добавлены необходимые рецепты; выполните расчёт снова.","recipes.expansionNotice":"Необходимые рецепты выбраны автоматически.","results.expansionEmpty":"Фильтр рецептов открыт, недостающие рецепты выбраны. Выполните расчёт снова.","recipes.filterOpen":"Открыть фильтр рецептов","recipes.showForMaterial":"Показать рецепты для «{name}»","graph.checkTitle":"Отметить {type} как проверенное","graph.checkAria":"Отметить {name} как проверенное","graph.building":"Производственное здание","graph.material":"Материал","graph.dragFilter":"Переместить панель фильтра рецептов","common.unknown":"Неизвестно","common.none":"Нет","recipes.count":"Рецептов: {count}","recipes.primary":"основной","recipes.byproduct":"побочный продукт","recipes.base":"базовый","recipes.alternate":"альтернативный","recipes.additional":"дополнительный","recipes.rawSource":"сырьё"},
    "zh-CN": {"status.loadFailed":"无法加载数据，请重试。","status.calcFailed":"计算失败。问题编号：{issue}。","status.expansionFailed":"当前配方选择无法生产目标材料。已添加所需配方，请重新计算。","recipes.expansionNotice":"已自动选择所需配方。","results.expansionEmpty":"配方筛选面板已打开，并已选择缺少的配方。请重新计算。","recipes.filterOpen":"打开配方筛选","recipes.showForMaterial":"查看{name}的配方","graph.checkTitle":"将{type}标记为已检查","graph.checkAria":"将{name}标记为已检查","graph.building":"生产建筑","graph.material":"材料","graph.dragFilter":"移动配方筛选面板","common.unknown":"未知","common.none":"无","recipes.count":"{count} 个配方","recipes.primary":"主产物","recipes.byproduct":"副产品","recipes.base":"基础","recipes.alternate":"替代","recipes.additional":"其他","recipes.rawSource":"原材料"},
    "zh-TW": {"status.loadFailed":"無法載入資料，請重試。","status.calcFailed":"計算失敗。問題編號：{issue}。","status.expansionFailed":"目前的配方選擇無法生產目標材料。已加入必要配方，請重新計算。","recipes.expansionNotice":"已自動選取必要配方。","results.expansionEmpty":"配方篩選面板已開啟，且已選取缺少的配方。請重新計算。","recipes.filterOpen":"開啟配方篩選","recipes.showForMaterial":"檢視{name}的配方","graph.checkTitle":"將{type}標記為已檢查","graph.checkAria":"將{name}標記為已檢查","graph.building":"生產建築","graph.material":"材料","graph.dragFilter":"移動配方篩選面板","common.unknown":"未知","common.none":"無","recipes.count":"{count} 個配方","recipes.primary":"主要產物","recipes.byproduct":"副產品","recipes.base":"基礎","recipes.alternate":"替代","recipes.additional":"其他","recipes.rawSource":"原始資源"},
    "uk-UA": {"status.loadFailed":"Не вдалося завантажити дані. Спробуйте ще раз.","status.calcFailed":"Не вдалося виконати обчислення. Ідентифікатор помилки: {issue}.","status.expansionFailed":"Поточний вибір не дає змоги виробити цілі. Додано потрібні рецепти; виконайте обчислення ще раз.","recipes.expansionNotice":"Потрібні рецепти вибрано автоматично.","results.expansionEmpty":"Фільтр рецептів відкрито, відсутні рецепти вибрано. Виконайте обчислення ще раз.","recipes.filterOpen":"Відкрити фільтр рецептів","recipes.showForMaterial":"Показати рецепти для {name}","graph.checkTitle":"Позначити {type} як перевірене","graph.checkAria":"Позначити {name} як перевірене","graph.building":"Виробнича споруда","graph.material":"Матеріал","graph.dragFilter":"Перемістити панель фільтра рецептів","common.unknown":"Невідомо","common.none":"Немає","recipes.count":"Рецептів: {count}","recipes.primary":"основний","recipes.byproduct":"побічний продукт","recipes.base":"базовий","recipes.alternate":"альтернативний","recipes.additional":"додатковий","recipes.rawSource":"сировина"},
}

APP_DESCRIPTION_COPY = {
    "fr-FR": "Planifiez les objectifs de production, les recettes, les ressources brutes et les flux d’usine de Satisfactory avec un graphe interactif.",
    "it-IT": "Pianifica obiettivi di produzione, ricette, materie prime e flussi di fabbrica di Satisfactory con un grafico interattivo.",
    "de-DE": "Plane Produktionsziele, Rezepte, Rohstoffe und Fabrikabläufe in Satisfactory mit einem interaktiven Produktionsgraphen.",
    "es-ES": "Planifica objetivos de producción, recetas, recursos en bruto y flujos de fábrica de Satisfactory con un gráfico interactivo.",
    "ja-JP": "インタラクティブな生産グラフで、Satisfactoryの生産目標、レシピ、原材料、工場の流れを計画できます。",
    "ko-KR": "대화형 생산 그래프로 Satisfactory의 생산 목표, 제작법, 원재료와 공장 흐름을 계획하세요.",
    "pl-PL": "Planuj cele produkcji, receptury, surowce i przepływ w fabryce w Satisfactory za pomocą interaktywnego grafu.",
    "pt-BR": "Planeje metas de produção, receitas, recursos brutos e o fluxo da fábrica em Satisfactory com um grafo interativo.",
    "ru-RU": "Планируйте цели производства, рецепты, сырьё и потоки на фабрике в Satisfactory с помощью интерактивного графа.",
    "zh-CN": "使用交互式生产图规划 Satisfactory 的生产目标、配方、原始资源和工厂流程。",
    "zh-TW": "使用互動式生產圖規劃 Satisfactory 的生產目標、配方、原始資源與工廠流程。",
    "uk-UA": "Плануйте цілі виробництва, рецепти, сировину та потоки на фабриці в Satisfactory за допомогою інтерактивного графа.",
}

PACKAGE_FLAG_COPY = {
    "fr-FR": {"recipes.packagedFlag": "conditionnée", "recipes.powerFlag": "recette énergétique"},
    "it-IT": {"recipes.packagedFlag": "confezionata", "recipes.powerFlag": "ricetta energetica"},
    "de-DE": {"recipes.packagedFlag": "verpackt", "recipes.powerFlag": "Energie-Rezept"},
    "es-ES": {"recipes.packagedFlag": "empaquetada", "recipes.powerFlag": "receta de energía"},
    "ja-JP": {"recipes.packagedFlag": "パッケージ化", "recipes.powerFlag": "発電レシピ"},
    "ko-KR": {"recipes.packagedFlag": "포장", "recipes.powerFlag": "발전 제작법"},
    "pl-PL": {"recipes.packagedFlag": "pakowana", "recipes.powerFlag": "receptura energetyczna"},
    "pt-BR": {"recipes.packagedFlag": "embalada", "recipes.powerFlag": "receita de energia"},
    "ru-RU": {"recipes.packagedFlag": "в упаковке", "recipes.powerFlag": "энергетический рецепт"},
    "zh-CN": {"recipes.packagedFlag": "包装", "recipes.powerFlag": "电力配方"},
    "zh-TW": {"recipes.packagedFlag": "包裝", "recipes.powerFlag": "電力配方"},
    "uk-UA": {"recipes.packagedFlag": "упакована", "recipes.powerFlag": "енергетичний рецепт"},
}

RECIPE_FILTER_COPY = {
    "fr-FR": {"recipes.clearAlternatesHelp":"Toutes les recettes de base sont déjà sélectionnées et aucune recette facultative ne l’est.","recipes.summaryFiltered":"{material} · {rows} lignes de recette · {selected} / {total} sélectionnées","recipes.summaryRequired":"{rows} lignes pour {required} recettes requises · {selected} / {total} sélectionnées","recipes.summaryAll":"{selected} / {total} sélectionnées · {materials} matériaux, {rows} lignes de recette visibles"},
    "it-IT": {"recipes.clearAlternatesHelp":"Tutte le ricette predefinite sono già selezionate e non ci sono ricette facoltative selezionate.","recipes.summaryFiltered":"{material} · {rows} righe di ricette · {selected} / {total} selezionate","recipes.summaryRequired":"{rows} righe per {required} ricette richieste · {selected} / {total} selezionate","recipes.summaryAll":"{selected} / {total} selezionate · {materials} materiali, {rows} righe di ricette visibili"},
    "de-DE": {"recipes.clearAlternatesHelp":"Alle Standardrezepte sind bereits ausgewählt und es sind keine optionalen Rezepte ausgewählt.","recipes.summaryFiltered":"{material} · {rows} Rezeptzeilen · {selected} / {total} ausgewählt","recipes.summaryRequired":"{rows} Zeilen für {required} erforderliche Rezepte · {selected} / {total} ausgewählt","recipes.summaryAll":"{selected} / {total} ausgewählt · {materials} Materialien, {rows} sichtbare Rezeptzeilen"},
    "es-ES": {"recipes.clearAlternatesHelp":"Ya están seleccionadas todas las recetas básicas y no hay recetas opcionales seleccionadas.","recipes.summaryFiltered":"{material} · {rows} filas de recetas · {selected} / {total} seleccionadas","recipes.summaryRequired":"{rows} filas para {required} recetas necesarias · {selected} / {total} seleccionadas","recipes.summaryAll":"{selected} / {total} seleccionadas · {materials} materiales, {rows} filas de recetas visibles"},
    "ja-JP": {"recipes.clearAlternatesHelp":"基本レシピはすべて選択済みで、追加レシピは選択されていません。","recipes.summaryFiltered":"{material} · レシピ行 {rows}件 · {selected} / {total}件を選択","recipes.summaryRequired":"必要なレシピ {required}件の行 {rows}件 · {selected} / {total}件を選択","recipes.summaryAll":"{selected} / {total}件を選択 · 素材 {materials}件、表示レシピ行 {rows}件"},
    "ko-KR": {"recipes.clearAlternatesHelp":"기본 제작법은 모두 선택되어 있으며 선택된 추가 제작법이 없습니다.","recipes.summaryFiltered":"{material} · 제작법 행 {rows}개 · {selected} / {total}개 선택","recipes.summaryRequired":"필요한 제작법 {required}개의 행 {rows}개 · {selected} / {total}개 선택","recipes.summaryAll":"{selected} / {total}개 선택 · 재료 {materials}개, 표시된 제작법 행 {rows}개"},
    "pl-PL": {"recipes.clearAlternatesHelp":"Wszystkie podstawowe receptury są już wybrane i nie wybrano żadnych opcjonalnych receptur.","recipes.summaryFiltered":"{material} · wiersze receptur: {rows} · wybrane: {selected} / {total}","recipes.summaryRequired":"Wiersze: {rows}, wymagane receptury: {required} · wybrane: {selected} / {total}","recipes.summaryAll":"Wybrane: {selected} / {total} · materiały: {materials}, widoczne wiersze receptur: {rows}"},
    "pt-BR": {"recipes.clearAlternatesHelp":"Todas as receitas básicas já estão selecionadas e nenhuma receita opcional está selecionada.","recipes.summaryFiltered":"{material} · {rows} linhas de receitas · {selected} / {total} selecionadas","recipes.summaryRequired":"{rows} linhas para {required} receitas necessárias · {selected} / {total} selecionadas","recipes.summaryAll":"{selected} / {total} selecionadas · {materials} materiais, {rows} linhas de receitas visíveis"},
    "ru-RU": {"recipes.clearAlternatesHelp":"Все базовые рецепты уже выбраны, дополнительных рецептов не выбрано.","recipes.summaryFiltered":"{material} · строк рецептов: {rows} · выбрано {selected} из {total}","recipes.summaryRequired":"Строк: {rows}, необходимых рецептов: {required} · выбрано {selected} из {total}","recipes.summaryAll":"Выбрано {selected} из {total} · материалов: {materials}, видимых строк рецептов: {rows}"},
    "zh-CN": {"recipes.clearAlternatesHelp":"已选择全部基础配方，且没有选择任何可选配方。","recipes.summaryFiltered":"{material} · {rows} 行配方 · 已选 {selected} / {total}","recipes.summaryRequired":"{required} 个所需配方共 {rows} 行 · 已选 {selected} / {total}","recipes.summaryAll":"已选 {selected} / {total} · {materials} 种材料，显示 {rows} 行配方"},
    "zh-TW": {"recipes.clearAlternatesHelp":"已選取全部基礎配方，且未選取任何選用配方。","recipes.summaryFiltered":"{material} · {rows} 列配方 · 已選 {selected} / {total}","recipes.summaryRequired":"{required} 個所需配方共 {rows} 列 · 已選 {selected} / {total}","recipes.summaryAll":"已選 {selected} / {total} · {materials} 種材料，顯示 {rows} 列配方"},
    "uk-UA": {"recipes.clearAlternatesHelp":"Усі базові рецепти вже вибрано, додаткових рецептів не вибрано.","recipes.summaryFiltered":"{material} · рядків рецептів: {rows} · вибрано {selected} із {total}","recipes.summaryRequired":"Рядків: {rows}, потрібних рецептів: {required} · вибрано {selected} із {total}","recipes.summaryAll":"Вибрано {selected} із {total} · матеріалів: {materials}, видимих рядків рецептів: {rows}"},
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

SAVED_PLAN_COPY = {
    "fr-FR": ["Enregistrer le plan de production", "Nom du plan", "Nom facultatif", "Laissez vide pour n’afficher que les icônes des matériaux cibles.", "Annuler", "Supprimer le plan enregistré : {plan}"],
    "it-IT": ["Salva piano di produzione", "Nome del piano", "Nome facoltativo", "Lascia vuoto per mostrare solo le icone dei materiali obiettivo.", "Annulla", "Elimina piano salvato: {plan}"],
    "de-DE": ["Produktionsplan speichern", "Planname", "Optionaler Name", "Leer lassen, um nur die Symbole der Zielmaterialien anzuzeigen.", "Abbrechen", "Gespeicherten Plan löschen: {plan}"],
    "es-ES": ["Guardar plan de producción", "Nombre del plan", "Nombre opcional", "Déjalo en blanco para mostrar solo los iconos de los materiales objetivo.", "Cancelar", "Eliminar plan guardado: {plan}"],
    "ja-JP": ["生産プランを保存", "プラン名", "任意の名前", "空欄にすると目標材料のアイコンのみ表示されます。", "キャンセル", "保存したプランを削除: {plan}"],
    "ko-KR": ["생산 계획 저장", "계획 이름", "선택 사항", "비워 두면 목표 재료 아이콘만 표시됩니다.", "취소", "저장된 계획 삭제: {plan}"],
    "pl-PL": ["Zapisz plan produkcji", "Nazwa planu", "Nazwa opcjonalna", "Pozostaw puste, aby wyświetlać tylko ikony materiałów docelowych.", "Anuluj", "Usuń zapisany plan: {plan}"],
    "pt-BR": ["Salvar plano de produção", "Nome do plano", "Nome opcional", "Deixe em branco para mostrar apenas os ícones dos materiais-alvo.", "Cancelar", "Excluir plano salvo: {plan}"],
    "ru-RU": ["Сохранить план производства", "Название плана", "Необязательное название", "Оставьте поле пустым, чтобы показывать только значки целевых материалов.", "Отмена", "Удалить сохранённый план: {plan}"],
    "zh-CN": ["保存生产方案", "方案名称", "可选名称", "留空则只显示目标材料图标。", "取消", "删除已保存方案：{plan}"],
    "zh-TW": ["儲存生產方案", "方案名稱", "選填名稱", "留空則只顯示目標材料圖示。", "取消", "刪除已儲存方案：{plan}"],
    "uk-UA": ["Зберегти план виробництва", "Назва плану", "Необов’язкова назва", "Залиште порожнім, щоб відображати лише значки цільових матеріалів.", "Скасувати", "Видалити збережений план: {plan}"],
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
        data["recipes.short"] = RECIPE_SHORT_LABELS[locale]
        data.update({key: value for key, value in zip(LOADING_KEYS, LOADING_COPY[locale], strict=True)})
        data.update(dict(zip([
            "targets.nameDialogTitle", "targets.nameLabel", "targets.namePlaceholder", "targets.nameHint",
            "targets.cancel", "targets.deleteSavedPlan",
        ], SAVED_PLAN_COPY[locale], strict=True)))
        data.update(ZH_EXTRA.get(locale, {}))
        data.update(LIVE_UI_COPY.get(locale, {}))
        data.update(LIVE_UI_EXTRA.get(locale, {}))
        data.update(LIVE_UI_HARDCODE_COPY.get(locale, {}))
        data["app.description"] = APP_DESCRIPTION_COPY[locale]
        data.update(PACKAGE_FLAG_COPY[locale])
        data.update(RECIPE_FILTER_COPY[locale])
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
