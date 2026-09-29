(() => {
  "use strict";

  const languages = {
    "en-US": ["English", "Privacy", "Factor Tools records anonymous usage events to check that the site works and learn which features need improvement.", "The dataset includes daily active browsers, interface language, viewport range, release version, feature events such as opening the item picker or running a calculation, and aggregate counts.", "It does not contain factory plan contents, target rates, saved plans, search text, IP addresses, or full user-agent strings. A random browser identifier changes every day and cannot follow a user across days. Usage data is retained for up to three months.", "Adding ?analytics_test=1 to the URL enables analytics test mode. Those records and automated test records are excluded from production statistics.", "Updated 2026-09-20"],
    "fr-FR": ["Français", "Confidentialité", "Factor Tools enregistre des événements d’utilisation anonymes pour vérifier le bon fonctionnement du site et savoir quelles fonctionnalités améliorer.", "Les données comprennent les navigateurs actifs par jour, la langue de l’interface, une plage de largeur d’écran, la version publiée, des événements comme l’ouverture du sélecteur de matériaux ou le lancement d’un calcul, ainsi que des totaux agrégés.", "Elles ne contiennent pas le contenu des plans d’usine, les débits cibles, les plans enregistrés, les termes recherchés, les adresses IP ni les chaînes complètes d’agent utilisateur. Un identifiant de navigateur aléatoire change chaque jour et ne permet pas de suivre une personne d’un jour à l’autre. Les données sont conservées au maximum trois mois.", "L’ajout de ?analytics_test=1 à l’adresse active le mode de test des statistiques. Ces données et celles des tests automatisés sont exclues des statistiques de production.", "Mise à jour : 20/09/2026"],
    "it-IT": ["Italiano", "Privacy", "Factor Tools registra eventi di utilizzo anonimi per verificare il funzionamento del sito e capire quali funzioni migliorare.", "I dati includono browser attivi giornalieri, lingua dell’interfaccia, fascia di larghezza della finestra, versione pubblicata, eventi come l’apertura del selettore dei materiali o l’avvio di un calcolo e conteggi aggregati.", "Non includono i contenuti dei piani della fabbrica, le quantità obiettivo, i piani salvati, i termini di ricerca, gli indirizzi IP o le stringhe complete dello user agent. Un identificatore casuale del browser cambia ogni giorno e non consente di seguire una persona da un giorno all’altro. I dati vengono conservati per un massimo di tre mesi.", "Aggiungendo ?analytics_test=1 all’URL si attiva la modalità di test delle statistiche. Questi dati e quelli dei test automatici sono esclusi dalle statistiche di produzione.", "Aggiornato il 20/09/2026"],
    "de-DE": ["Deutsch", "Datenschutz", "Factor Tools erfasst anonyme Nutzungsereignisse, um die Funktion der Website zu prüfen und zu erfahren, welche Funktionen verbessert werden sollten.", "Die Daten umfassen täglich aktive Browser, die Oberflächensprache, einen Bereich der Fensterbreite, die Release-Version, Ereignisse wie das Öffnen der Materialauswahl oder eine Berechnung sowie zusammengefasste Zählwerte.", "Nicht erfasst werden Fabrikplaninhalte, Zielmengen, gespeicherte Pläne, Suchbegriffe, IP-Adressen oder vollständige User-Agent-Zeichenfolgen. Eine zufällige Browserkennung ändert sich täglich und kann Personen nicht über mehrere Tage verfolgen. Die Nutzungsdaten werden höchstens drei Monate gespeichert.", "Mit ?analytics_test=1 in der URL wird der Statistik-Testmodus aktiviert. Diese Daten und Daten automatisierter Tests fließen nicht in die Produktionsstatistik ein.", "Aktualisiert am 20.09.2026"],
    "es-ES": ["Español", "Privacidad", "Factor Tools registra eventos de uso anónimos para comprobar que el sitio funciona y saber qué funciones necesitan mejoras.", "Los datos incluyen navegadores activos por día, idioma de la interfaz, un intervalo del ancho de pantalla, versión publicada, eventos como abrir el selector de materiales o ejecutar un cálculo y recuentos agregados.", "No incluyen el contenido de los planes de fábrica, las cantidades objetivo, los planes guardados, los términos de búsqueda, las direcciones IP ni cadenas completas del agente de usuario. Un identificador aleatorio del navegador cambia cada día y no permite seguir a una persona entre días. Los datos se conservan durante un máximo de tres meses.", "Al añadir ?analytics_test=1 a la URL se activa el modo de prueba de estadísticas. Esos datos y los de las pruebas automatizadas se excluyen de las estadísticas de producción.", "Actualizado el 20/09/2026"],
    "ja-JP": ["日本語", "プライバシー", "Factor Tools は、サイトの動作確認と改善が必要な機能の把握のため、匿名の利用イベントを記録します。", "記録するのは、日ごとのアクティブなブラウザー数、画面言語、画面幅の範囲、リリース版、素材選択画面を開く・計算を実行するなどの機能イベント、および集計数です。", "工場プランの内容、目標生産量、保存したプラン、検索語、IPアドレス、完全なユーザーエージェント文字列は記録しません。ランダムなブラウザー識別子は毎日変わるため、日をまたいで利用者を追跡できません。利用データは最長3か月保存します。", "URL に ?analytics_test=1 を追加すると統計テストモードになります。この記録と自動テストの記録は本番統計から除外されます。", "更新日：2026年9月20日"],
    "ko-KR": ["한국어", "개인정보 보호", "Factor Tools는 사이트가 정상적으로 작동하는지 확인하고 개선이 필요한 기능을 파악하기 위해 익명 사용 이벤트를 기록합니다.", "기록 항목에는 일일 활성 브라우저 수, 인터페이스 언어, 화면 너비 범위, 릴리스 버전, 재료 선택기를 열거나 계산을 실행하는 등의 기능 이벤트와 집계 수치가 포함됩니다.", "공장 계획 내용, 목표 생산량, 저장된 계획, 검색어, IP 주소 또는 전체 사용자 에이전트 문자열은 포함하지 않습니다. 무작위 브라우저 식별자는 매일 바뀌므로 날짜를 넘겨 사용자를 추적할 수 없습니다. 사용 데이터는 최대 3개월 동안 보관됩니다.", "URL에 ?analytics_test=1을 추가하면 통계 테스트 모드가 활성화됩니다. 해당 기록과 자동 테스트 기록은 운영 통계에서 제외됩니다.", "업데이트: 2026-09-20"],
    "pl-PL": ["Polski", "Prywatność", "Factor Tools zapisuje anonimowe zdarzenia użycia, aby sprawdzać działanie witryny i ustalać, które funkcje wymagają ulepszeń.", "Zestaw danych obejmuje dzienną liczbę aktywnych przeglądarek, język interfejsu, zakres szerokości okna, wersję wydania, zdarzenia funkcji, takie jak otwarcie wyboru materiałów lub uruchomienie obliczeń, oraz zbiorcze liczniki.", "Nie obejmuje zawartości planów fabryki, wartości docelowych, zapisanych planów, wyszukiwanych haseł, adresów IP ani pełnych ciągów user-agent. Losowy identyfikator przeglądarki zmienia się codziennie i nie pozwala śledzić użytkownika między dniami. Dane użycia są przechowywane maksymalnie przez trzy miesiące.", "Dodanie ?analytics_test=1 do adresu URL włącza tryb testowy statystyk. Te dane i dane z testów automatycznych są wykluczane ze statystyk produkcyjnych.", "Aktualizacja: 20.09.2026"],
    "pt-BR": ["Português (Brasil)", "Privacidade", "Factor Tools registra eventos anônimos de uso para verificar se o site funciona e identificar quais recursos precisam de melhorias.", "Os dados incluem navegadores ativos por dia, idioma da interface, faixa de largura da tela, versão publicada, eventos de recursos como abrir o seletor de materiais ou executar um cálculo e contagens agregadas.", "Eles não incluem o conteúdo dos planos de fábrica, taxas-alvo, planos salvos, termos de pesquisa, endereços IP ou strings completas do agente do usuário. Um identificador aleatório do navegador muda diariamente e não permite acompanhar uma pessoa entre dias. Os dados de uso são mantidos por até três meses.", "Adicionar ?analytics_test=1 à URL ativa o modo de teste das estatísticas. Esses registros e os de testes automatizados são excluídos das estatísticas de produção.", "Atualizado em 20/09/2026"],
    "ru-RU": ["Русский", "Конфиденциальность", "Factor Tools записывает анонимные события использования, чтобы проверять работу сайта и понимать, какие функции нужно улучшить.", "Данные включают число активных за день браузеров, язык интерфейса, диапазон ширины окна, версию выпуска, события функций — например, открытие выбора материалов или запуск расчёта — и агрегированные счётчики.", "В них нет содержимого планов фабрики, целевых объёмов, сохранённых планов, поисковых запросов, IP-адресов и полных строк User-Agent. Случайный идентификатор браузера меняется ежедневно и не позволяет отслеживать пользователя между днями. Данные использования хранятся не более трёх месяцев.", "Добавление ?analytics_test=1 к URL включает тестовый режим статистики. Эти записи и записи автоматических тестов исключаются из производственной статистики.", "Обновлено: 20.09.2026"],
    "zh-CN": ["简体中文", "隐私说明", "Factor Tools 会记录匿名的使用情况，以了解网站是否正常工作以及哪些功能需要改进。", "记录内容包括：每日活跃浏览器、界面语言、设备宽度范围、网站版本，以及打开材料选择、执行计算、切换结果视图等功能事件和汇总数量。", "统计数据不包含工厂方案内容、目标产量、保存的方案、搜索文字、IP 地址或完整浏览器标识。浏览器标识随机生成并每天更换，不能用来跨天追踪用户。统计数据最多保留三个月。", "网址加入 ?analytics_test=1 后会进入统计测试模式；这类记录和自动化测试记录不会计入正式统计。", "更新于 2026-09-20"],
    "zh-TW": ["繁體中文", "隱私權聲明", "Factor Tools 會記錄匿名的使用事件，以確認網站正常運作並了解哪些功能需要改進。", "記錄內容包括：每日活躍瀏覽器、介面語言、視窗寬度範圍、發布版本，以及開啟材料選擇器、執行計算、切換結果檢視等功能事件與彙總數量。", "統計資料不包含工廠方案內容、目標產量、已儲存方案、搜尋文字、IP 位址或完整的使用者代理字串。隨機產生的瀏覽器識別碼每天更換，無法跨日追蹤使用者。使用資料最多保留三個月。", "網址加入 ?analytics_test=1 後會啟用統計測試模式；這類記錄及自動化測試記錄不會計入正式統計。", "更新日期：2026-09-20"],
    "uk-UA": ["Українська", "Конфіденційність", "Factor Tools записує анонімні події використання, щоб перевіряти роботу сайту та визначати, які функції потрібно покращити.", "Дані містять кількість активних за день браузерів, мову інтерфейсу, діапазон ширини вікна, версію випуску, події функцій — наприклад, відкриття вибору матеріалів або запуск обчислення — та агреговані лічильники.", "Вони не містять вмісту планів фабрики, цільових обсягів, збережених планів, пошукових запитів, IP-адрес чи повних рядків User-Agent. Випадковий ідентифікатор браузера змінюється щодня й не дає змоги відстежувати користувача між днями. Дані використання зберігаються не довше трьох місяців.", "Додавання ?analytics_test=1 до URL вмикає тестовий режим статистики. Ці записи та записи автоматичних тестів не враховуються у виробничій статистиці.", "Оновлено: 20.09.2026"],
  };

  const localeNames = Object.fromEntries(Object.entries(languages).map(([locale, values]) => [locale, values[0]]));
  const localeParam = new URLSearchParams(window.location.search).get("lang");
  let storedLocale = "";
  try {
    storedLocale = localStorage.getItem("satisfactoryProductionPlanner.locale.v1") || "";
  } catch (_error) {
    // The page remains usable when browser storage is disabled.
  }
  const requestedLocale = String(localeParam || storedLocale || navigator.language || "en-US").replace(/_/g, "-");
  const selectedLocale = Object.keys(languages).find((locale) => locale.toLowerCase() === requestedLocale.toLowerCase())
    || Object.keys(languages).find((locale) => locale.split("-")[0].toLowerCase() === requestedLocale.split("-")[0].toLowerCase())
    || "en-US";
  let selected = selectedLocale;

  const select = document.getElementById("privacyLanguage");
  const content = document.getElementById("privacyContent");
  const link = document.getElementById("privacyHomeLink");
  const selectLabel = {"en-US":"Language","fr-FR":"Langue","it-IT":"Lingua","de-DE":"Sprache","es-ES":"Idioma","ja-JP":"言語","ko-KR":"언어","pl-PL":"Język","pt-BR":"Idioma","ru-RU":"Язык","zh-CN":"语言","zh-TW":"語言","uk-UA":"Мова"};

  Object.entries(localeNames).forEach(([locale, label]) => select.add(new Option(label, locale)));
  select.value = selected;
  select.addEventListener("change", () => {
    selected = select.value;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", selected);
    window.history.replaceState({}, "", url);
    render();
  });

  function render() {
    const [language, title, ...paragraphs] = languages[selected] || languages["en-US"];
    document.documentElement.lang = selected;
    document.title = `Factor Tools · ${title}`;
    document.querySelector('label[for="privacyLanguage"]').textContent = selectLabel[selected] || "Language";
    select.setAttribute("aria-label", selectLabel[selected] || "Language");
    link.textContent = `← Factor Tools`;
    link.href = `/?lang=${encodeURIComponent(selected)}`;
    content.replaceChildren();
    const heading = document.createElement("h1");
    heading.textContent = title;
    content.appendChild(heading);
    paragraphs.slice(0, 4).forEach((text, index) => {
      const paragraph = document.createElement("p");
      if (index === 3) {
        const [before, after] = text.split("?analytics_test=1");
        paragraph.append(document.createTextNode(before));
        const code = document.createElement("code");
        code.textContent = "?analytics_test=1";
        paragraph.append(code, document.createTextNode(after || ""));
      } else {
        paragraph.textContent = text;
      }
      content.appendChild(paragraph);
    });
    document.getElementById("privacyUpdated").textContent = paragraphs[4];
  }

  render();
})();
