# reel: модель «ядро + плагины» и как устроены Lampa, Stremio, Kodi и другие

Дата исследования: 13.11.2026. Это общая информация по открытым источникам, а не юридическая консультация. Перед публичным релизом, а тем более перед отправкой в сторы, стоит показать архитектуру и тексты юристу, который работает с авторским правом в ЕС и Польше.

Пометки: **[проверено]** означает, что я сам смотрел исходники или первичный документ. **[вторично]** означает пересказ СМИ, блогов или авто-вики. **[не уверен]** означает, что подтверждения не нашёл.

---

## 0. Коротко

1. Lampa на деле устроена так: ядро (каталог на TMDB + клиент к TorrServer + клиент к Jackett/Prowlarr) плюс JS-плагины, которые пользователь сам добавляет по URL. Все адреса серверов в ядре по умолчанию пустые, торрент-поиск выключен. Перед установкой первого плагина пользователь соглашается с правилами. Но репозиторий не «стерильный»: в `plugins/` лежат модули онлайн-источников, в коде прописан публичный парсер [адрес публичного парсера удалён], а в 2022 году на файл `okko.js` в ядре пришёл DMCA от Okko.
2. Требования правообладателей почти всегда бьют по **источникам контента**, то есть по плагинам, расширениям и спискам индексаторов. Голый движок или плеер не трогают. Примеры: Aniyomi-extensions (Sony, 2024), Tachiyomi (Kakao, 2024), TVAddons (Bell, 2017–2022), Filmspeler (CJEU, 2017). Движки WebTorrent, librqbit, TorrServer и qBittorrent живут спокойно.
3. В ЕС главный риск для разработчика задаёт решение CJEU **Filmspeler (C‑527/15)**. Продажа плеера **с предустановленными** дополнениями, которые ведут на заведомо нелегальные источники, сама считается «сообщением публике». Поэтому всё, что ведёт к пиратскому контенту, нельзя ни предустанавливать, ни рекомендовать.
4. В США работают тест **Sony Betamax** (существенные законные применения) и тест **Grokster** (inducement: призывы и маркетинг в пользу нарушений). Для open-source это значит: важен не только код, но и README, скриншоты, issue и Discord.
5. Сторы: Google Play торрент-клиенты в целом пропускает, но запрещает приложения, которые «поощряют» нарушения. Apple не пропускает P2P (5.2.3) и запрещает загружать код, меняющий функциональность (2.5.2). При этом по 4.7 за плагины в приложении отвечает разработчик. Samsung требует лицензии для «P2P app».

---

## 1. Lampa

### 1.1 Что это и что лежит в ядре

- Репозиторий [yumata/lampa-source](https://github.com/yumata/lampa-source) распространяется под лицензией **GPL‑2.0** [проверено через GitHub API]. Сборка: `npm install && npm run start`. Готовая веб-версия раздаётся с lampa.mx, нативные обёртки (Android APK, Tizen/webOS) распространяются отдельно.
- Встроенные «Условия использования» (`src/lang/en.js`, ключи `termsofuse_t_*`) [проверено] описывают Lampa как «удобный инструмент для изучения новостей киноиндустрии»: метаданные берутся из TMDB, «информация общедоступна и не нарушает авторских прав». Про расширения сказано: «users install extensions at their own risk. All consequences arising from the use of extensions are the responsibility of the user». Для правообладателей есть контакт и обещание удалять материалы по уведомлению. Есть и встроенная заглушка `dmca_descr`: «This material is not available for viewing. It has been blocked at the request of the copyright holder».
- Источник каталога: TMDB API (постеры, описания, трейлеры). Видеоконтента в ядре формально нет.

### 1.2 Как ставятся плагины

- UI для этого лежит в `src/interaction/extensions/` [проверено], файл `add.js`. При первом нажатии «Добавить плагин» появляется модальное окно с правилами (`install_extension_rule_1..7`). Согласие сохраняется в `Storage.agree_installation`. Текст правил [проверено, `src/lang/en.js`]:
  > Plugins are created by independent developers, and LAMPA does not verify their content… If the plugin you install violates copyright or other laws, you are fully responsible for its use… **LAMPA does not support or endorse plugins related to pirated content.**
- Дальше пользователь вводит URL JS-файла (`extensions_set_url`). По данным DeepWiki, ядро скачивает файл и проверяет, что в нём есть строка `Lampa` [вторично, [DeepWiki 11.1](https://deepwiki.com/yumata/lampa-source/11.1-plugin-loading-and-management)]. После этого плагин исполняется в контексте приложения с полным доступом к API `Lampa.*`: `Lampa.SettingsApi.addComponent`, `Lampa.Component.add`, `Lampa.Menu.addButton`.
- Кроме ручной установки есть плагины «из аккаунта» (синхронизация через CUB/lampa.mx) и раздел рекомендованных и популярных расширений `CUB.extensions()` [вторично, DeepWiki]. **Это важная деталь.** Витрина плагинов внутри приложения ослабляет тезис «мы ничего не предлагаем»: оценка зависит от того, что именно в этой витрине показывают.
- Адреса плагинов пользователи находят в Telegram-чатах и блогах, а не на официальном сайте ([iGuides](https://www.iguides.ru/blogs/appdt/lampa-na-apple-tv/), [teletype](https://teletype.in/@lme/newcategory)) [вторично].
- Сторонняя серверная сборка **Lampac** ([Docker Hub immisterio/lampac](https://hub.docker.com/r/immisterio/lampac)) раздаёт плагины `ts.js` (TorrServer) и `lite.js` (онлайн и Jackett) со своего сервера. Её делают другие авторы [вторично].

### 1.3 Как устроены торренты

- Lampa **сама торренты не качает**. Она обращается к **TorrServer** как к HTTP-сервису: передаёт magnet или .torrent и получает плейлист и HTTP-поток. Настройки `torrserver_url`, `torrserver_url_two`, `torrserver_login/password` **по умолчанию пустые** [проверено, `src/interaction/settings/params.js`, строки ~812–823].
- Поиск раздач (раздел «Парсер») работает через **Jackett или Prowlarr по API Torznab**. Тумблер `parser_use` **по умолчанию false**, `parse_in_search` тоже false, `jackett_url`, `jackett_key` и `prowlarr_*` пустые [проверено]. Пользователь должен сам вписать адрес индексатора.
- **Нюанс, который портит «чистую» картину** [проверено]: в `src/core/api/sources/parser.js` и `params.js` есть миграция [адрес публичного парсера удалён] → [адрес публичного парсера удалён]. Это публичный агрегатор раздач с русских трекеров. Код знает конкретный пиратский индексатор и чинит пользователям его адрес. Там же есть опция `parser_torrent_type` со значением `rutor` (поиск по встроенной базе TorrServer, см. ниже). reel так делать не должен.
- На Android TorrServer может работать как отдельное приложение (MatriX); тогда `reg = Platform.is('android')` включает источник без URL.

### 1.4 Откуда берётся контент

- Официально только метаданные TMDB. Видео приходит из (а) торрентов через TorrServer + парсер, который настроил пользователь; (б) «онлайн»-плагинов, которые парсят пиратские стриминговые «балансеры».
- **В официальном репозитории есть `plugins/online/`** [проверено] с адресами API нелицензионного российского стримингового сайта [адреса удалены]. Сборка этих плагинов, видимо, раздаётся отдельно, но исходник лежит в основном репо.
- **История DMCA** [проверено, [github/dmca 2022-11-04-okko.md](https://github.com/github/dmca/blob/master/2022/11/2022-11-04-okko.md)]: Okko LLC через агента потребовала удалить `src/utils/api/okko.js` из `yumata/lampa-source` и форков, потому что модуль давал доступ к IPTV-каналам Okko. Сейчас в дереве нет `src/utils/api/okko.js`; судя по всему, модуль удалили. Других DMCA-уведомлений против Lampa или TorrServer в `github/dmca` по ключевым словам `lampa` и `TorrServer` я не нашёл [проверено поиском; поиск по коду GitHub неполный].

### 1.5 Юридическое позиционирование Lampa

- Формула такая: «агрегатор метаданных с TMDB + расширения, за которые отвечает пользователь + реагируем на жалобы». Дисклеймеры встроены в UI (правила перед установкой плагина, страница Terms of Use). В README репозитория юридического текста нет [проверено через WebFetch README].
- Слабые места, которые reel повторять не стоит: витрина рекомендованных плагинов, исходники пиратских онлайн-плагинов в основном репо, захардкоженный [адрес публичного парсера удалён], модуль под конкретный коммерческий сервис (Okko), сообщество в Telegram, где раздают адреса пиратских плагинов. Аудитория Lampa в основном в РФ и СНГ, где правообладатели меньше пользуются DMCA. Для разработчика из Польши выводы о «безопасности» Lampa переносить нельзя.

---

## 2. TorrServer (YouROK, MatriX)

- Репозиторий [YouROK/TorrServer](https://github.com/YouROK/TorrServer). Лицензия **GPL‑3.0**, около 3.2k звёзд, активно развивается [проверено через GitHub API]. «MatriX» — линейка версий и Android-сборка того же автора.
- Распространение [проверено, README]: бинарники в Releases (Windows, Linux, macOS, ARM), install-скрипты, Docker `ghcr.io/yourok/torrserver`, iOS XCFramework. В README прямо сказано: «The XCFramework is statically linked, so the combined iOS app is a GPL‑3.0 derivative work. **Public App Store submission of BitTorrent clients may be rejected under Guideline 5.2.3.**» Есть также сторонние NAS-пакеты.
- Каталог и поиск:
  - **Torznab-поиск** (Jackett, Prowlarr) есть, по умолчанию выключен (`EnableTorznabSearch`, список URL пустой) [проверено, `server/settings/btsets.go`].
  - **Встроенный поиск по базе RuTor** (`server/rutor/rutor.go`): при включённом `EnableRutorSearch` сервер скачивает дамп базы публичного трекера с сервера автора [адрес удалён] [проверено]. По умолчанию флаг выключен (`SetDefaultConfig` его не ставит). Но получается, что **автор сам хостит индекс пиратского трекера**, и это заметно хуже, чем «только Torznab».
  - В настройках по умолчанию есть TMDB (`APIURL`, а также `ImageURLRu: imagetmdb.com`) для постеров.
  - Telegram-бот и MCP-сервер с поиском.
- Общего дисклеймера в README нет [проверено].

Вывод для reel: librqbit внутри приложения закрывает роль TorrServer. Брать от TorrServer стоит HTTP-API для внешних клиентов и Torznab. Встроенную базу трекера брать не нужно.

---

## 3. Похожие проекты

| Проект | Ядро | Источники контента | Что случилось юридически |
|---|---|---|---|
| **Kodi** (GPL) | медиацентр без контента | официальный репозиторий аддонов (аудит) + сторонние репозитории; установка из «Unknown sources» по умолчанию выключена, при включении показывается предупреждение | сам Kodi не преследуют; Фонд воюет с продавцами «pirate boxes» через товарный знак; авторов пиратских репозиториев преследуют (TVAddons) |
| **Stremio** (ядро и SDK — MIT) | плеер + клиент аддон-протокола | официальные аддоны (Cinemeta, YouTube и т.п.), community-аддоны по URL манифеста; Torrentio — сторонний | Stremio как компания существует; давят на аддоны и их хостинг [вторично] |
| **Jellyfin** (GPL‑2.0) | медиасервер для своей библиотеки | только файлы пользователя + метаданные | претензий нет; модель «ваши собственные файлы» |
| **Popcorn Time** | торрент-стример с встроенным каталогом YTS/EZTV | каталог встроен | DMCA на GitHub в 2014 и 2020; форк popcorn-time.tw закрылся в 2022 |
| **WebTorrent Desktop** (MIT) | торрент-стример | только то, что принёс пользователь; в комплекте **легальные демо-торренты** | претензий нет |
| **qBittorrent** | торрент-клиент | поиск выключен по умолчанию; поисковые плагины в отдельном репо, неофициальные ставит пользователь | претензий к ядру нет |
| **Sonarr, Radarr, Prowlarr, Jackett** | автоматизация и индексация | индексаторы добавляет пользователь; Jackett хранит YAML-определения трекеров, включая пиратские | репозитории живут годами (GPL‑2.0) |
| **Tachiyomi, Aniyomi** | читалка и плеер | расширения из «официального» репо внутри приложения | Kakao (2024): проект закрылся, расширения удалены; Sony (2024): DMCA на APK расширений Aniyomi |

### 3.1 Kodi

- Позиция Фонда изложена в статье [«The Freedom of Choice»](https://www.kodi.tv/article/freedom-of-choice). Сторонние репозитории «not usable by default… user needs to have made an informed choice». За официальный репозиторий Фонд отвечает и проводит аудит, за сторонние не отвечает [вторично, сайт отдаёт 403 боту, цитаты взяты из поисковой выдачи].
- [Add-on manager wiki](https://kodi.wiki/view/Add-on_manager): переключатель «Unknown sources» выключен по умолчанию, при включении показывается предупреждение.
- [Piracy policy / Banned add-ons](https://kodi.wiki/view/Official:Forum_rules/Banned_add-ons): на официальных площадках запрещены поддержка и упоминание пиратских аддонов; действует zero tolerance. Kodi защищает товарный знак, а не код [вторично].
- **TVAddons** (Канада): в 2017 году Bell, Rogers и Videotron подали иск против крупнейшего репозитория сторонних аддонов. В 2022 году основатель Адам Лакман согласился на consent judgment с выплатой **C$25 млн** и бессрочным запретом разрабатывать и распространять Kodi-аддоны ([TorrentFreak](https://torrentfreak.com/tvaddons-adam-lackman-admits-tv-show-piracy-agrees-to-pay-us14-5m-220224/), [MobileSyrup](https://mobilesyrup.com/2022/02/25/i-admitted-liability-adam-lackman-tvaddons-pay-25-million-piracy-case/)). **Главный урок:** риск несёт тот, кто публикует и раздаёт аддоны к нелегальным источникам, а не автор ядра.

### 3.2 Stremio

- SDK [Stremio/stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk) (MIT) [проверено]. Аддон — это **HTTP-сервис, который отдаёт JSON**: `manifest.json`, `/catalog`, `/meta`, `/stream`, `/subtitles`. «**Stremio never runs your code.** The app reads your manifest… and calls the matching resources over HTTP.» Поток может быть `url` (HTTP), `infoHash` (BitTorrent), YouTube и т.д. ([docs/api/responses/stream.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md)). Клиентская часть протокола — [stremio-core](https://github.com/Stremio/stremio-core) на Rust.
- Пользователь ставит аддон по URL манифеста или из каталога community-аддонов (`publishToCentral`). В качестве официального BitTorrent-аддона называют только Vodo; Torrentio — сторонний аддон, Stremio его не оперирует [вторично, [cloudwards](https://www.cloudwards.net/best-stremio-add-ons)].
- Для reel это самая полезная модель: **плагин как удалённые данные, а не как исполняемый код**. Модель безопаснее (нет произвольного JS), лучше совместима с правилами App Store 2.5.2 и 4.7 и переносима на Tizen.

### 3.3 Popcorn Time

- В приложение был **встроен** каталог (API YTS и EZTV), то есть на экране сразу был «Netflix для пиратки». Это классическая позиция для претензий по Grokster и Filmspeler.
- 2014: MPAA потребовала удалить репозитории с GitHub ([Techdirt](https://archive.techdirt.com/articles/20140711/18044627859/mpaa-stretches-dmca-to-breaking-point-with-questionable-take-down-request-popcorn-time-repositories.shtml)). 2016: под удар попал даже легальный спин-офф Butter ([TorrentFreak](https://torrentfreak.com/mpaa-takedown-efforts-target-legal-popcorn-time-spin-offs-160315/)).
- Май 2020: MPA прислала DMCA, где указала, что приложение «includes links to pirate sites, pirate APIs, and pirate torrent trackers». GitHub удалил репозиторий. Разработчики подали встречное уведомление («The code is 100% ours»). MPA не подала иск в течение 10–14 рабочих дней, и GitHub восстановил код ([TorrentFreak, 20.05.2020](https://torrentfreak.com/github-reinstates-popcorn-time-code-despite-mpa-threat-200520/)).
- Январь 2022: популярный форк закрылся «due to a lack of interest» ([Bloomberg](https://www.bloomberg.com/news/articles/2022-01-04/popcorn-time-alternative-is-hard-to-find-as-app-shuts-down)). Сведения о том, какой именно форк закрылся, расходятся [вторично].

### 3.4 WebTorrent Desktop

- [webtorrent/webtorrent-desktop](https://github.com/webtorrent/webtorrent-desktop), MIT. Ровно та модель, которая подходит ядру reel: пользователь сам вставляет magnet или .torrent, а в комплект входят **только легальные демо-торренты**. В `static/` лежат `bigBuckBunny.torrent`, `sintel.torrent`, `tearsOfSteel.torrent`, `cosmosLaundromat.torrent` (открытые фильмы Blender) и `wiredCd.torrent` (CC-музыка) [проверено]. Поиска и каталога нет.

### 3.5 qBittorrent search plugins

- Поисковый движок по умолчанию **выключен** (View → Search engine) и требует Python ([wiki](https://github.com/qbittorrent/search-plugins/wiki/Install-search-plugins)) [вторично, но согласуется с репозиторием].
- Плагины лежат в отдельном репозитории [qbittorrent/search-plugins](https://github.com/qbittorrent/search-plugins). Его README [проверено]: «Use the plugins and the websites they connect to at your own risk. You are personally responsible for following the copyright laws…», «This repository is maintained by community contributors. It is not directly managed by the qBittorrent core team.»
- При этом среди «официальных» движков в `nova3/engines` есть `piratebay.py`, `eztv.py`, `limetorrents.py` и `torlock.py` [проверено]. Неофициальные плагины перечислены в вики, пользователь ставит их вручную. Модель «отдельный репо + выключено по умолчанию» qBittorrent пока выдерживает, но строже, чем нужно, она не устроена. Насколько сейчас плагины предустанавливаются в сборках, я не проверил [не уверен].

### 3.6 Sonarr, Radarr, Prowlarr, Jackett

- [Jackett](https://github.com/Jackett/Jackett) (GPL‑2.0, около 16k звёзд) содержит YAML-определения трекеров, в том числе для публичных пиратских трекеров [названия файлов удалены] [проверено]. Prowlarr держит их в [Prowlarr/Indexers](https://github.com/Prowlarr/Indexers). Индексатор подключает пользователь, к Sonarr и Radarr он синхронизируется через Torznab.
- Эти проекты годами живут на GitHub. Однако они **не являются плеерами**: показать «кино в один клик» они не могут, и это снижает «inducement-профиль». Для reel полезен прежде всего **протокол Torznab** как стандартный способ подключить чужой индексатор.

### 3.7 Tachiyomi и Aniyomi как самый близкий прецедент «ядро + расширения»

- Tachiyomi (январь 2024): после угроз Kakao Entertainment разработчики сначала выпустили версии без предзагруженного списка расширений, затем удалили расширения и заморозили проект. Форк Mihon поставляется **без встроенного репозитория расширений** ([TorrentFreak](https://torrentfreak.com/tachiyomi-manga-reader-how-threats-can-motivate-pirates-boost-engagement-240113/), [AlternativeTo](https://alternativeto.net/news/2024/1/manga-reader-app-tachiyomi-ceases-development-amid-legal-threats-from-kakao-entertainment)) [вторично].
- Aniyomi (июнь 2024): MarkScan от имени Sony Pictures прислал DMCA на APK расширений в `aniyomiorg/aniyomi-extensions` ([github/dmca 2024-06-11-sonypictures.md](https://github.com/github/dmca/blob/master/2024/06/2024-06-11-sonypictures.md)) [проверено]. В уведомлении буквально описан сценарий «открыли настройки → список расширений внутри приложения → поставили → смотрим Jujutsu Kaisen». Удаления потребовали для **расширений**, ядро в уведомлении не упомянуто.

---

## 4. Право: что важно для open-source-разработчика

### 4.1 США

- **Sony v. Universal (Betamax, 1984).** Производитель устройства не отвечает за нарушения пользователей, если устройство «capable of substantial non-infringing uses». Для reel это довод в пользу легального демо-контента, локальных файлов и Torznab к любым индексаторам: законные применения должны быть реальными и **видимыми**.
- **MGM v. Grokster (2005).** Суд ввёл **inducement**: ответственность наступает, если продукт распространяют «with the object of promoting its use to infringe copyright, as shown by clear expression or other affirmative steps taken to foster infringement». Само по себе знание о возможных нарушениях или техподдержка такой ответственности не создаёт ([EFF](https://w2.eff.org/IP/P2P/MGM_v_Grokster/), [CACM](https://cacm.acm.org/opinion/the-supreme-court-revisits-the-sony-safe-harbor)). В Grokster как доказательства умысла использовали **рекламу, ориентацию на бывших пользователей Napster и бизнес-модель**. Отсюда правило: никакого пиратского маркетинга, никаких скриншотов с релизами, никаких ответов в issue вида «вот как найти новый фильм».
- **DMCA §512 (уведомления на GitHub).** После встречного уведомления контент возвращают через 10–14 рабочих дней, если заявитель не подаст иск. Так было с Popcorn Time в 2020 году. GitHub публикует все уведомления в [github/dmca](https://github.com/github/dmca).
- **DMCA §1201 (обход ТСЗ).** Именно на нём строилась претензия RIAA к **youtube-dl**: в октябре 2020 года проект удалили, 16.11.2020 восстановили после письма EFF. GitHub изменил процедуру рассмотрения жалоб по §1201 и создал фонд защиты разработчиков на $1 млн ([TechCrunch](https://techcrunch.com/2020/11/16/github-defies-riaa-takedown-notice-restoring-youtube-dl-and-starting-1m-defense-fund), [The Register](https://www.theregister.com/2020/11/16/github_restores_youtubedl/)). **Продолжение в ЕС:** в 2023 году Landgericht Hamburg обязал хостера Uberspace убрать сайт youtube-dl, а в ноябре 2024 года OLG Hamburg отклонил апелляцию и признал хостера ответственным ([TorrentFreak](https://torrentfreak.com/court-rejects-appeal-of-youtube-dl-hosting-provider-uberspace-241127/), [heise](https://heise.de/-10179284)). Для reel отсюда следует: **ничего не обходить** (DRM, токены, подписи и защиту стриминговых сервисов). Торрент сам по себе ТСЗ не обходит, а вот плагины к «онлайн-балансерам» и сервисам вроде Okko легко попадают под §1201 и под немецкую практику.

### 4.2 ЕС и Польша

- **Filmspeler, C‑527/15 (26.04.2017)** ([curia](https://curia.europa.eu/jcms/jcms/p1_339660/mt), [IPKat](https://ipkitten.blogspot.com/2017/04/breaking-cjeu-in-filmspeler-rules-that.html)). Продажа медиаплеера с **предустановленными** аддонами, которые ведут к заведомо нелегальным источникам, признана «communication to the public» (ст. 3(1) InfoSoc). Суд учитывал рекламу («смотри бесплатно») и знание продавца. Это **ключевой прецедент для модели «ядро + плагины»**: граница проходит между «ничего не предустановлено и не рекомендовано» и «предустановлено или продвигается».
- **GS Media, C‑160/15 (2016)**: ссылка на нелегальный контент нарушает права, если ссылающийся знал или должен был знать о нелегальности. При коммерческой цели знание презюмируется. Поэтому списки «рекомендованных» пиратских индексаторов в README или wiki опасны.
- **Ziggo / The Pirate Bay, C‑610/15 (2017)**: оператор индекса торрентов совершает «сообщение публике».
- **ACI Adam, C‑435/12 (2014)**: исключение для частного копирования не распространяется на копии из **нелегального источника** ([Kluwer](https://legalblogs.wolterskluwer.com/copyright-blog/no-more-downloading-from-unlawful-sources/)).
- **Mircom, C‑597/19 (17.06.2021)**: раздача кусков файла через P2P (seeding, включая автоматический) является «making available», если пользователь был информирован о том, как работает клиент. Порога de minimis нет ([IPKat](https://ipkitten.blogspot.com/2021/06/cjeu-rules-on-seeding-trolls-and.html), [Kluwer](https://legalblogs.wolterskluwer.com/copyright-blog/cjeu-in-c-59719-mircom-users-of-p2p-networks-might-be-infringing-the-making-available-right-if-duly-informed/)). Для **пользователей** reel это значит, что стриминг торрента почти всегда сопровождается раздачей. Честно об этом сказать и дать настройку ограничения отдачи — хорошая практика.
- **Польша.** Ст. 23 закона об авторском праве (*dozwolony użytek osobisty*) разрешает личное использование уже распространённых произведений ([Wikipedia](https://en.wikipedia.org/wiki/Private_fair_use_(Poland)), [WIPO](https://www.wipo.int/wipolex/en/legislation/details/3500)). В польской доктрине долго считалось, что скачивание для себя допустимо. После ACI Adam такое толкование сомнительно, а **раздача** (а торрент всегда раздаёт) под ст. 23 не подпадает [вторично; точную судебную практику по ст. 79 и уголовным статьям 116 и 118 я не проверял, **не уверен**]. Для разработчика в Польше в первую очередь действуют стандарты ЕС (Filmspeler, GS Media). Есть и практическое соображение: имя и адрес автора, живущего в ЕС, правообладателям легко найти. Не стоит, по примеру авторов Lampa, рассчитывать на анонимность.

### 4.3 Сторы

- **Apple.** [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) [проверено]:
  - 5.2.3: «Apps should not facilitate illegal file sharing or include the ability to save, convert, or download media from third-party sources… without explicit authorization».
  - 2.5.2: приложение не может «download, install, or execute code which introduces or changes features or functionality of the app».
  - 4.7: HTML5/JS-плагины разрешены, но «**You are responsible for all such software offered in your app**». По 4.7.4 нужен индекс всех плагинов, по 4.7.1 — фильтрация и жалобы.
  - Итог: JS-плагины по URL, как в Lampa, на iOS не пройдут ревью, а торрент-движок, скорее всего, отклонят по 5.2.3 (это прямо признаёт README TorrServer). В ЕС через альтернативные магазины (AltStore PAL) нотаризация Apple всё равно нужна. В августе 2025 года Apple отозвала у разработчика **iTorrent** права на альтернативную дистрибуцию в ЕС ([MacRumors](https://www.macrumors.com/2025/08/27/apple-blocks-itorrent-app-eu/), [heise](https://heise.de/-10625008)). Официальная причина в источниках расходится: часть СМИ пишет о санкционном комплаенсе [не уверен].
- **Google Play.** [Политика по интеллектуальной собственности](https://support.google.com/googleplay/android-developer/answer/9888072) [проверено]: «We don't allow apps that induce or encourage copyright infringement». Среди примеров нарушений: «Apps that encourage users to stream and download copyrighted works». Торрент-клиенты как класс в Play есть (LibreTorrent, Flud и др.). Приложения-«фронтенды» к The Pirate Bay Google снимал ещё в 2014 году ([TorrentFreak](https://torrentfreak.com/google-removes-pirate-bay-apps-play-store-141205)). Вывод: в Play-версии не должно быть никаких предложенных источников, и описание в листинге должно быть нейтральным.
- **Samsung (Tizen TV / Galaxy Store).** В [IP Infringement Checklist](https://developer.samsung.com/galaxy-store/ip-infringement.html) «P2P app» значится среди категорий, для которых при регистрации требуют лицензионные соглашения правообладателей [вторично, страница Galaxy Store]. Отдельного правила TV Seller Office о торрентах я не нашёл [не уверен]. Реалистично ориентироваться на установку на Tizen в режиме разработчика или sideload (`.wgt`, Tizen Studio), а не на Samsung Apps.
- **F-Droid** — естественный канал для Android: проект собирает из исходников и помечает антифичи (например, `NonFreeNet`). Про DMCA у них есть отдельный разбор ([F-Droid blog, 2025](https://f-droid.org/ru/2025/09/10/how-foss-projects-handle-legal-takedown-requests.html)).

---

## 5. Рекомендации для reel

### 5.1 Что входит в ядро (`reel` repo)

1. **Движок librqbit**, который проигрывает **любой magnet или .torrent, переданный пользователем**: вставка ссылки, открытие файла, share-intent на Android, drag&drop на macOS, ввод на TV с телефона по QR или в локальной сети.
2. **Локальные файлы и сетевые папки** (SMB, DLNA, WebDAV), опционально клиент **Jellyfin**. Это самые сильные «substantial non-infringing uses».
3. **Демо-каталог только из легального контента**, как в WebTorrent Desktop: открытые фильмы Blender (Big Buck Bunny, Sintel, Tears of Steel, Cosmos Laundromat, Spring и др.), торренты Internet Archive (Prelinger Archives, фильмы в общественном достоянии; у каждого item на archive.org есть `_archive.torrent`), Wikimedia Commons. Лучше оформить его как **встроенный плагин того же формата**, что и сторонние. Тогда протокол сразу проверяется на реальных данных, а у пользователя после установки есть что посмотреть.
4. **Метаданные (TMDB и т.п.) только как обогащение** того, что пользователь уже добавил: распознавание названия по имени файла, постеры. Если есть ядро-«витрина» с трендами и кнопкой «Смотреть» без легального источника, на экране получается Popcorn Time, только с пустой кнопкой. Если витрина нужна, кнопка без источника должна вести к трейлеру, к «где посмотреть легально» (JustWatch-подобные данные) или к «добавить свой источник». Нельзя, чтобы она молча искала торрент. Условия использования TMDB тоже стоит проверить: нужна атрибуция и некоммерческий ключ [не уверен в деталях].
5. **HTTP-API движка** (аналог TorrServer: `/stream?link=…`), чтобы TV и внешние плееры могли подключаться к reel на десктопе. Это нейтральная инфраструктура.
6. **Протоколы плагинов** (Torznab-клиент, клиент аддон-протокола) **без единого предзаполненного адреса**. Тумблер «Источники» выключен по умолчанию, все поля пустые.

### 5.2 Что оставить плагинам, которые ставит пользователь

- Поиск раздач (индексаторы), каталоги «что посмотреть», подписки и RSS, субтитры из сторонних баз.
- Ничего из этого не предустанавливается, не рекомендуется и не показывается в виде списка внутри приложения.

### 5.3 Как устанавливать плагины

1. **Основной путь: декларативный HTTP-протокол в стиле Stremio.** Плагин — это URL манифеста (JSON) с ресурсами `catalog`, `meta`, `stream` (magnet, `infoHash`, HTTP) и `subtitles`. Можно реализовать **совместимость с протоколом аддонов Stremio** (он открытый, SDK под MIT): тогда экосистема существующих аддонов подключается без единой строки кода с нашей стороны. Плюсы: никакого исполняемого кода в приложении, что важно для iOS 2.5.2 и Tizen, и меньше вопросов к безопасности.
2. **Torznab/Newznab-эндпоинты**: пользователь вводит URL и API-ключ своего Jackett или Prowlarr (как в Lampa и TorrServer). reel не знает и не хранит ни одного адреса трекера. Не повторять миграцию [адрес публичного парсера удалён] → [адрес публичного парсера удалён] из Lampa.
3. **Исполняемые JS или WASM-плагины** (модель Lampa) — только на десктопе и Android, в песочнице, и только если без них не обойтись. На iOS их не включать.
4. UX установки: поле «URL источника» + **экран согласия при первом добавлении** (по образцу правил Lampa, см. текст ниже). Затем показать манифест: имя, автор, домены, что плагин запрашивает. Предусмотреть отключение и удаление. **Не делать** встроенной витрины или каталога плагинов, «рекомендованных», «популярных» и синхронизации списков через облако проекта. Именно витрина делает «ядро + плагины» похожим на «Filmspeler с предустановкой» и на сценарий из DMCA против Aniyomi.
5. Deep link `reel://add-source?url=…` допустим, но пусть приложение всегда показывает экран подтверждения.

### 5.4 Чего не должно быть нигде (код, README, сайт, сторы, issue, чаты)

- Предустановленных или «рекомендованных» пиратских индексаторов, аддонов и балансеров, а также их адресов в коде, тестах, фикстурах, примерах конфигов, документации и в истории git. Если что-то случайно попало в историю, переписать историю до публикации.
- Модулей под конкретные коммерческие сервисы (как `okko.js` у Lampa), обхода DRM, токенов или подписей стриминговых сервисов (риск §1201 и практика OLG Hamburg по youtube-dl).
- Формулировок вроде «смотри новинки бесплатно», «замена Netflix», «без подписки», «кинотеатр в один клик», «все фильмы мира». Пиратской символики (паруса, черепа), названий в духе «Popcorn», «Pirate», «Free».
- **Скриншотов и видео с постерами и кадрами коммерческих фильмов**: в README, в сторах и в Figma-моках, которые попадут в репо. Использовать только открытые фильмы Blender и общественное достояние.
- Тестовых magnet-ссылок на коммерческие релизы. Для тестов брать Sintel, Big Buck Bunny, Linux ISO и раздачи Internet Archive.
- Ответов мейнтейнеров в issue или Discord о том, «где взять плагин с новинками». Это ровно те «affirmative steps» из Grokster. Нужна политика в `CONTRIBUTING.md` и шаблонах issue: такие вопросы закрываются без ответа по существу.
- Телеметрии, которая собирает названия просматриваемого: иначе проект сам «знает» о нарушениях.

### 5.5 Отдельная организация или репозиторий для плагинов: что это меняет

- **Отдельный репо со «своими» пиратскими плагинами юридически почти ничего не меняет.** Если плагины пишет или публикует тот же человек, это та же ответственность (TVAddons, Aniyomi-extensions, Kakao против контрибьюторов Tachiyomi). Отдельный репо только ограничивает радиус DMCA: удалят его, а не ядро.
- Что реально помогает: **ядро и официальная организация публикуют только легальные плагины** (демо-каталог, Internet Archive, локальная сеть, Jellyfin, плагин-пример «Torznab-клиент» без адресов). Сторонние плагины пишут **другие люди**, в своих аккаунтах и без ссылок из проекта. Lampa, Stremio, Kodi и Mihon фактически держатся на этом разделении. Слабые места появляются там, где проект сам ведёт витрину.
- Отдельный репозиторий для **SDK и спецификации протокола** (`reel-addon-sdk`, `reel-protocol`) полезен технически и показывает нейтральность: это спецификация, а не каталог.

### 5.6 Лицензия и гигиена репозитория

- librqbit распространяется под Apache‑2.0 [проверено, `crates/librqbit/Cargo.toml` в ikatson/rqbit]. Лицензию ядра можно выбрать любую совместимую: MIT/Apache для максимальной совместимости со сторами или GPL‑3.0, чтобы закрытые форки-«кинотеатры» не забирали код. Важно: GPL‑3.0 конфликтует с правилами App Store, известный случай — VLC в 2011 году [вторично, по памяти; проверить]. Если iOS в планах, это аргумент за MIT/Apache‑2.0 или MPL‑2.0.
- Файлы в репо: `README.md` с нейтральным описанием, `LEGAL.md` или `DISCLAIMER.md`, `CONTRIBUTING.md` с политикой контента, `SECURITY.md`. Ещё `docs/plugins.md`: спецификация протокола + пример на открытом контенте.
- Указать контакт для правообладателей (отдельный email) и честно реагировать на жалобы. Если придёт уведомление по DMCA на сам движок без пиратского контента, рассмотреть встречное уведомление, как сделали Popcorn Time и youtube-dl, и обратиться в EFF или GitHub Developer Defense Fund. Если жалоба обоснована, удалить нужное.
- Название и бренд: «reel» нейтрально. Стоит проверить пересечения по товарным знакам в EUIPO/WIPO [не проверял].

### 5.7 Черновик формулировок

**README (первый абзац):**
> reel is an open-source media player for TV, mobile and desktop. It plays your own media: local files, network shares, and torrents you add yourself (magnet links and .torrent files), with a built-in BitTorrent engine based on librqbit. Out of the box it includes a small catalogue of openly licensed films (Blender Open Movies, Internet Archive public-domain collections).
>
> reel does not include, host, index or link to any copyrighted content, and ships with no third-party content sources. Sources can be added only by the user, by entering the address of a compatible service (Torznab, reel add-on protocol).

**LEGAL.md или раздел Disclaimer:**
> reel is a general-purpose media player and BitTorrent client. The project does not provide, host or recommend any content sources, indexers or add-ons other than those listed in this repository, which serve openly licensed content only. Third-party add-ons are developed and distributed by independent parties; the reel project does not review, endorse or support them, and will not help to find them. You are responsible for making sure that what you watch, download and share is legal in your country. Note that BitTorrent uploads (seeds) the data you download to other peers. Rights holders can contact us at legal@<domain>.

**Экран при первом добавлении источника (UI, по образцу Lampa):**
> **Add a third-party source.** Sources are made by independent developers; reel does not check them. Some sources may collect data about you or provide content you are not allowed to access. You are responsible for the sources you add and for how you use them. While playing torrents, reel also uploads data to other users. [Cancel] [I understand, continue]

**CONTRIBUTING.md (фрагмент):**
> Do not open issues or PRs that add, mention or ask about sources of copyrighted content (sites, trackers, add-ons, playlists). Such issues are closed and locked. Screenshots and test fixtures must use openly licensed media only (see `docs/test-media.md`).

### 5.8 Платформенная стратегия

- **Android:** GitHub Releases + F-Droid сразу. Google Play — с нейтральным листингом, без единого источника; быть готовым к отказу.
- **macOS:** нотаризованный DMG и Homebrew cask. Mac App Store не нужен.
- **Tizen:** `.wgt` для установки в режиме разработчика. Seller Office, скорее всего, потребует лицензии для P2P [не уверен].
- **iOS:** App Store — только сборка **без торрент-движка** (локальные файлы, сетевые папки, Jellyfin, клиент к reel-серверу на десктопе или NAS по HTTP-API). Полная версия — через сборку из исходников, AltStore или SideStore. При этом в ЕС Apple показала (iTorrent), что может отозвать права на альтернативную дистрибуцию.

---

## 6. Источники (основные)

- Lampa: https://github.com/yumata/lampa-source (файлы `src/interaction/extensions/add.js`, `src/interaction/settings/params.js`, `src/core/api/sources/parser.js`, `src/lang/en.js`, `plugins/online/`); DMCA Okko: https://github.com/github/dmca/blob/master/2022/11/2022-11-04-okko.md; DeepWiki: https://deepwiki.com/yumata/lampa-source/11.1-plugin-loading-and-management
- TorrServer: https://github.com/YouROK/TorrServer (README, `server/rutor/rutor.go`, `server/settings/btsets.go`)
- Stremio SDK: https://github.com/Stremio/stremio-addon-sdk
- WebTorrent Desktop: https://github.com/webtorrent/webtorrent-desktop
- qBittorrent search plugins: https://github.com/qbittorrent/search-plugins
- Jackett: https://github.com/Jackett/Jackett; Prowlarr Indexers: https://github.com/Prowlarr/Indexers
- Kodi: https://www.kodi.tv/article/freedom-of-choice, https://kodi.wiki/view/Add-on_manager, https://kodi.wiki/view/Official:Forum_rules/Banned_add-ons
- TVAddons: https://torrentfreak.com/tvaddons-adam-lackman-admits-tv-show-piracy-agrees-to-pay-us14-5m-220224/
- Popcorn Time: https://torrentfreak.com/github-reinstates-popcorn-time-code-despite-mpa-threat-200520/, https://www.bloomberg.com/news/articles/2022-01-04/popcorn-time-alternative-is-hard-to-find-as-app-shuts-down
- Aniyomi DMCA: https://github.com/github/dmca/blob/master/2024/06/2024-06-11-sonypictures.md; Tachiyomi: https://torrentfreak.com/tachiyomi-manga-reader-how-threats-can-motivate-pirates-boost-engagement-240113/
- youtube-dl: https://techcrunch.com/2020/11/16/github-defies-riaa-takedown-notice-restoring-youtube-dl-and-starting-1m-defense-fund, https://torrentfreak.com/court-rejects-appeal-of-youtube-dl-hosting-provider-uberspace-241127/
- Grokster и Sony: https://w2.eff.org/IP/P2P/MGM_v_Grokster/, https://cacm.acm.org/opinion/the-supreme-court-revisits-the-sony-safe-harbor
- CJEU: Filmspeler https://ipkitten.blogspot.com/2017/04/breaking-cjeu-in-filmspeler-rules-that.html; Mircom https://ipkitten.blogspot.com/2021/06/cjeu-rules-on-seeding-trolls-and.html; ACI Adam https://legalblogs.wolterskluwer.com/copyright-blog/no-more-downloading-from-unlawful-sources/
- Польша: https://en.wikipedia.org/wiki/Private_fair_use_(Poland)
- Apple: https://developer.apple.com/app-store/review/guidelines/; iTorrent: https://www.macrumors.com/2025/08/27/apple-blocks-itorrent-app-eu/
- Google Play: https://support.google.com/googleplay/android-developer/answer/9888072
- Samsung: https://developer.samsung.com/galaxy-store/ip-infringement.html
