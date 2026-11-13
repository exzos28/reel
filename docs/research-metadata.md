# Метаданные для reel: IMDb, альтернативы, аниме-базы и архитектура

Исследование от 2026-11-13. Только слой метаданных: каталог, постеры, описания, рейтинги, актёры, сезоны и эпизоды, поиск, подборки. Источники видео сюда не входят.

> Это общая информация, а не юридическая консультация. Условия сервисов меняются, перед релизом их надо перечитать.

Пометки: **[проверено]** — прочитано на официальной странице во время исследования; **[не проверено]** — сторонние источники, форумы или мои знания, официального подтверждения не нашёл.

---

## TL;DR

- **IMDb напрямую не подключаем.** Официальный API (AWS Data Exchange) — это корпоративный контракт, цена по запросу. Бесплатные датасеты разрешены только для «personal and non-commercial use», а постеров и описаний в них нет. Скрейпинг запрещён условиями IMDb. От IMDb берём только **ID (`tt…`) как ключ для связи** и, по желанию, **рейтинг через OMDb с ключом пользователя**.
- **Основной источник — TMDB.** Фильмы, сериалы, сезоны и эпизоды, постеры, фоны, **логотипы названий**, кадры эпизодов, переводы на многие языки (включая польский), trending, `external_ids` с IMDb и TVDB. Бесплатно для некоммерческого использования с атрибуцией. Ключ проекта вшиваем, но даём пользователю ввести свой.
- **Аниме — AniList** (GraphQL, без ключа, бесплатно для некоммерческого использования) плюс **маппинги ID** из `Fribb/anime-lists` и `Anime-Lists/anime-lists`. Так аниме-тайтл связывается с TMDB и TVDB, откуда берутся картинки и эпизоды. Оригинальный `manami-project/anime-offline-database` **заархивирован 2026-07-04**. Его продолжает форк `cedya77/anime-offline-database`.
- **Опционально, с ключом или логином пользователя:** Trakt (история и скробблинг), OMDb (рейтинги IMDb, RT, Metacritic), Fanart.tv (clearlogo и clearart), TVDB (по PIN подписчика), MAL, Shikimori, Simkl.
- **Клиент метаданных живёт в Rust-ядре** с SQLite-кэшем, дисковым кэшем картинок и TTL. UI на TS получает уже нормализованные модели.

---

## 1. IMDb

### 1.1 Официальные варианты

| Вариант | Что даёт | Условия | Статус |
|---|---|---|---|
| **IMDb Non-Commercial Datasets** (`datasets.imdbws.com`, описание на `data.imdb.com/non-commercial-datasets/`) | 7 TSV-файлов в gzip, обновляются ежедневно: `title.basics` (тип, названия, годы, длительность, жанры), `title.akas` (локальные названия по регионам и языкам), `title.crew` (режиссёры, сценаристы), `title.episode` (родитель, номер сезона, номер эпизода), `title.principals` (основной состав), `title.ratings` (**averageRating, numVotes**), `name.basics` (люди) | «Subsets of IMDb data are available for access to customers for **personal and non-commercial use**. You can hold local copies of this data, and it is subject to our terms and conditions.» | [проверено] |
| | **Чего нет:** постеров и любых картинок, описаний (plot), трейлеров, наград, списков популярного, поиска (только сырые дампы). | | [проверено] |
| **IMDb API через AWS Data Exchange** (GraphQL) | Полный каталог, картинки, описания, рейтинги, box office | Контракт через AWS Marketplace, **публичной цены нет**, только quote (`imdb-licensing-support@imdb.com`). Сверх контракта: около $0.00000093 за 100 байт. В стороннем блоге фигурирует «от ~$150 000 в год». | цена [не проверено] |
| **Скрейпинг imdb.com** | — | Conditions of Use: «You may not use data mining, robots, screen scraping, or similar data gathering and extraction tools on this site, except with our express written consent». Логотипы и товарные знаки IMDb нельзя использовать в чужом продукте. | [проверено] |

Источники:
- https://data.imdb.com/non-commercial-datasets/ (бывший `developer.imdb.com/non-commercial-datasets/`)
- https://www.imdb.com/conditions
- https://aws.amazon.com/marketplace/pp/prodview-yeuyizioqmfsy (листинг IMDb на AWS)
- https://api.market/blog/sleeyax/entertainment/best-movie-apis (оценка $150k в год, сторонний источник)

### 1.2 Может ли open-source приложение использовать данные IMDb

- **IMDb ID (`tt0111161`, `nm0000151`).** Это идентификаторы, де-факто общий стандарт для связи баз. Их хранят и раздают TMDB (`external_ids`), Wikidata (свойство P345, данные под CC0), Trakt, OMDb, Stremio. Хранить и показывать `imdb_id`, а также давать ссылку `https://www.imdb.com/title/tt…/` без логотипа IMDb — практика всей индустрии, риск минимальный.
- **Рейтинги IMDb из датасетов.** Лицензия формулирует «personal and non-commercial». «Personal» плохо сочетается с раздачей данных тысячам пользователей через приложение. Поэтому:
  - не вшивать `title.ratings` в приложение и не раздавать его со своего сервера;
  - теоретически каждый клиент может сам скачать `title.ratings.tsv.gz` (около 7–8 МБ, [не проверено]) для «личного» использования. Это серая зона и лишний трафик на ТВ, не рекомендую по умолчанию;
  - **рекомендация:** рейтинг IMDb показывать **только через OMDb с ключом пользователя** (OMDb отдаёт `imdbRating` и `imdbVotes`), а по умолчанию показывать рейтинг TMDB.
- **Логотип и бренд IMDb** (жёлтая плашка «IMDb 8.4») без письменного разрешения использовать нельзя. Текстовая подпись «IMDb 8.4» в строке рейтингов — обычная практика (Stremio, Kodi), но строго говоря это тоже товарный знак. Нейтральный вариант — значок-источник собственного дизайна.

### 1.3 Что используют другие

| Проект | Метаданные |
|---|---|
| **Kodi** | Скрейперы по умолчанию — **TMDB** (фильмы) и **TMDB TV Shows**. Дефолт для сериалов переключили с TVDB на TMDB около 2018–2020 (источники расходятся). Опционально тянет рейтинги IMDb и Trakt. TVDB v4 — отдельный скрейпер. https://kodi.wiki/view/Add-on:The_Movie_Database, https://kodi.wiki/view/Add-on%3ATMDb_TV_Shows |
| **Jellyfin** | Встроенные провайдеры **TMDB** и **OMDb**. TVDB, AniDB, AniList, Fanart.tv — плагины. Для аниме: Shokofin (Shoko Server, AniDB по хэшу файла), AnimeMultiSource (AniList, AniDB, Jikan, Fribb-маппинги). [частично не проверено] https://github.com/ShokoAnime/Shokofin |
| **Stremio** | Встроенный аддон **Cinemeta**, всё индексируется по **IMDb ID** (`tt…`, эпизоды как `tt…:S:E`). Данные Cinemeta по разным документам идут из IMDb и/или TMDB [не проверено]. Популярная замена — AIOMetadata (TMDB, TVDB, AniList, MAL, Fanart). https://github.com/Stremio/stremio-addons/blob/master/docs/tutorial/using-cinemeta.md |
| **Lampa** | **TMDB** напрямую или через прокси **CUB** (для регионов, где TMDB заблокирован; добавляет свои подборки). https://deepwiki.com/yumata/lampa-source/5.1-tmdb-api-integration [не проверено, вторичный источник] |
| **Sonarr** | TVDB через свой прокси SkyHook, плюс TheXEM для перенумерации сцены и аниме. https://wiki.servarr.com/sonarr/xem-guide |

**Вывод:** никто из открытых проектов не ходит в IMDb напрямую. Все используют TMDB (или TVDB) и IMDb ID как общий ключ.

---

## 2. Альтернативы IMDb

### 2.1 TMDB (The Movie Database) — основной источник

**Условия** (https://www.themoviedb.org/api-terms-of-use, https://developer.themoviedb.org/docs/faq) [проверено]:
- Бесплатно **только для некоммерческого использования**. Коммерческое (платное приложение, реклама, платный сайт, **обучение ИИ на данных**) — по отдельному договору (`sales@themoviedb.org`). Что считать коммерческим, решает TMDB, и он может пересмотреть решение. Бесплатное open-source приложение без рекламы — некоммерческое.
- **Атрибуция обязательна:** логотип TMDB из одобренных (менее заметный, чем лого reel) и текст. В Terms: «This [application] uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.» В FAQ короче: «This product uses the TMDB API but is not endorsed or certified by TMDB.» Место — экран About/Credits. Берём формулировку из Terms, она строже.
- **Кэш до 6 месяцев.** После прекращения лицензии всё удалить.
- Запрещено: делать производные от API или контента (не собирать «свою базу» на дампе TMDB), использовать TMDB как хостинг картинок для рекламы, обучать ИИ, вводить в заблуждение об источнике, скрывать идентичность приложения, нарушать закон и чужие права.
- **Ключ в open-source клиенте:** Terms это прямо не регулируют. Kodi, Jellyfin и многие другие держат ключ проекта в открытом коде [не проверено по каждому]. Риск в том, что ключ извлекут, начнут им злоупотреблять, и TMDB его отзовёт. Для торрент-стримера есть отдельный риск: пункт о «нарушении прав других» даёт TMDB повод отозвать ключ, если приложение будет восприниматься как пиратское. Это аргумент за **запасной путь: собственный ключ пользователя**.
- **Rate limit:** около 40 запросов в секунду на IP, «может измениться в любой момент». При 429 — backoff. https://developer.themoviedb.org/docs/rate-limiting [проверено]

**Что даёт API v3** (по документации и моим знаниям, endpoint'ы стабильны годами):
- `/movie/{id}`, `/tv/{id}`, `/tv/{id}/season/{n}`, `/tv/{id}/season/{n}/episode/{e}`. С `append_to_response=credits,images,videos,external_ids,content_ratings,release_dates,recommendations` получаем всё за один запрос.
- `/tv/{id}/episode_groups` и `/tv/episode_group/{id}` — **альтернативные порядки эпизодов** (absolute, DVD, story arc). Это важно для аниме, см. §3.2.
- `/trending/{all|movie|tv|person}/{day|week}`, `/movie/popular`, `/tv/on_the_air`, `/discover/movie` и `/discover/tv` (фильтры по жанру, году, языку, `with_original_language=ja`, `with_keywords=210024` = anime).
- `/search/multi|movie|tv|person`.
- `/find/{external_id}?external_source=imdb_id|tvdb_id|wikidata_id|…` — поиск по чужому ID. Обратно — `/movie/{id}/external_ids`: `imdb_id`, `tvdb_id`, `wikidata_id`, соцсети.
- **Картинки:** `poster`, `backdrop`, **`logo`** (логотипы названий, как в наших макетах), `still` (кадр эпизода), `profile` (люди). CDN `https://image.tmdb.org/t/p/{size}{path}`, размеры из `/configuration`: постеры `w92…w780, original`, бэкдропы `w300, w780, w1280, original`, логотипы `w45…w500, original`. Фильтр по языку картинки — `include_image_language=pl,en,null` (`null` = без текста, удобно для фонов).
- **Локализация:** `language=pl-PL` на любом запросе. `/translations` отдаёт все переводы названия и описания. Если перевода нет, текст пустой, и переход на `en-US` делаем сами. Рейтинги и сертификаты по стране: `release_dates`, `content_ratings` (PL, US…).
- Рейтинг: `vote_average` и `vote_count` (пользователи TMDB).

### 2.2 TVDB (TheTVDB, v4)

https://thetvdb.com/api-information, https://thetvdb.com/subscribe, https://github.com/thetvdb/v4-api
- Ключи выдаются **проекту**. Две модели: (а) контракт (для open source обещают «significant discounts», условия по запросу); (б) **user-supported**: проект получает ключ, а пользователь вводит **PIN подписчика** ($11.99 в год, один PIN работает во всех проектах). [проверено частично]
- Тарифы по выручке на агрегаторах (бесплатно до $50k выручки с атрибуцией, дальше $1k, $10k…) [не проверено].
- Атрибуция со ссылкой на TheTVDB.com видна пользователю.
- Сильные стороны: порядки эпизодов (aired, DVD, absolute, alternate), его использует Sonarr, а аниме-маппинги ScudLee построены вокруг TVDB.
- **Для reel:** только опционально (ключ проекта и PIN пользователя). По умолчанию не нужен, TMDB покрывает сериалы, а маппинги AniDB→TMDB уже есть.

### 2.3 Trakt

- REST API, OAuth 2.0 (есть **device code flow**: `/oauth/device/code`, пользователь вводит код на `trakt.tv/activate`; идеально для ТВ). Скробблинг (`/scrobble/start|pause|stop`), история, watchlist, списки, trending и popular, рекомендации. **Картинок нет**, только ID (trakt, slug, imdb, tmdb, tvdb).
- Лимиты: около 1000 GET за 5 минут, POST и PUT около 1 в секунду [не проверено, старая документация].
- 2025: Trakt ужесточил бесплатный тариф (watchlist и списки до 100 элементов, затем подняли до 250) и удвоил цену VIP. Часть методов VIP-only (HTTP 426). В стороннем плагине есть упоминание, что с середины 2026 **создание API-приложения стало VIP-фичей** [не проверено, официального подтверждения не нашёл]. https://alternativeto.net/news/2025/2/trakt-tv-has-set-stricter-limits-for-free-users-and-raised-vip-subscription-prices-by-100-
- `client_secret` в открытом коде — проблема (Trakt не поддерживает PKCE [не проверено]). На практике open-source клиенты (Kodi script.trakt) держат client id и secret в репозитории.
- **Для reel:** опционально (подключить аккаунт Trakt). Только синхронизация «смотрю, просмотрено», не источник каталога.

### 2.4 OMDb

https://www.omdbapi.com/apikey.aspx [проверено]
- Бесплатный ключ: **1000 запросов в день**. Patreon-тариф снимает лимит и даёт постеры через Poster API (суммы на странице не указаны; исторически от $1 в месяц [не проверено]).
- Контент под **CC BY-NC 4.0**. Не аффилирован с IMDb.
- Отдаёт `imdbRating`, `imdbVotes`, `Ratings[]` (IMDb, Rotten Tomatoes, Metacritic), `Metascore`, плюс плот, жанры и прочее по `i=tt…`.
- **Для reel:** только ключ пользователя. 1000 запросов в день на всех пользователей с одним ключом проекта не хватит, а раздача ключа нарушит лимит. Кэшировать рейтинги на 7 дней.

### 2.5 Wikidata

- **CC0** (данные можно использовать без ограничений), SPARQL (`query.wikidata.org`) и `wbgetentities`. Нужен вежливый `User-Agent`, лимиты мягкие (60 секунд CPU в минуту на SPARQL [не проверено]).
- Свойства-идентификаторы [проверено через API Wikidata]:

| Свойство | ID |
|---|---|
| IMDb ID | **P345** |
| TMDB movie ID | **P4947** |
| TMDB TV series ID | **P4983** |
| TheTVDB series ID | **P4835** |
| AniList anime ID | **P8729** |
| MyAnimeList anime ID | **P4086** |
| AniDB anime ID | **P5646** |
| Kitsu anime ID | **P11495** |
| Trakt.tv ID / Trakt film ID | **P8013** / **P12492** |

- Плюсы: многоязычные названия (`labels`, включая pl и uk), связь фильм↔книга, страна, награды. Минусы: покрытие эпизодов и свежих релизов слабое, аниме-ID заполнены не у всех.
- **Для reel:** вторичный, бесплатный, без ключа. Резервный резолвер ID (особенно IMDb↔TMDB↔AniList для фильмов) и источник локализованных названий.

### 2.6 Fanart.tv

- Тип картинок: **clearlogo / hdtvlogo** (логотип названия на прозрачном фоне), clearart, characterart, banner, thumb, disc, background, seasonposter. Ключи по TMDB ID (фильмы) и TVDB ID (сериалы).
- **Project key** обязателен (бесплатный, для приложения). **Personal key** опционален, его вводит пользователь. С ключом проекта новые картинки видны через 7 дней после одобрения, с личным — через 2 дня, у VIP — около 10 минут. [не проверено, сторонние README и форумы; сайт не отдался]. https://medium.com/fanart-tv/what-are-fanart-tv-personal-api-keys-472f60222856
- **Для reel:** TMDB сам отдаёт `logos`, их хватает для большинства тайтлов. Fanart.tv подключить как второй источник логотипов (ключ проекта по умолчанию допустим, это их модель) с fallback'ом на типографский логотип, как в макетах.

### 2.7 OpenSubtitles (REST API, opensubtitles.com)

- Для приложения нужен **consumer API key** (бесплатный). Квоты скачиваний считаются по пользователю: аноним — около 5 в сутки на IP, бесплатный аккаунт — около 20 в сутки (источники расходятся: 10–100), VIP — до 1000 в сутки. В ответе есть `remaining` и `reset_time`. https://opensubtitles.tawk.help/article/about-the-api [частично не проверено]
- **Для reel:** это тема субтитров, не метаданных. Упоминаю, потому что поиск идёт по `imdb_id`, `tmdb_id`, `parent_imdb_id` + `season_number` + `episode_number`, а значит модель ExternalIds должна это покрывать. Ключ приложения вшиваем, логин пользователя опционален.

### 2.8 Сводка: ключ проекта или пользователя

| Источник | По умолчанию в reel | Ключ | Можно ли вшить ключ проекта в open-source клиент |
|---|---|---|---|
| TMDB | **да, основной** | ключ проекта + поле «свой ключ» | Terms не запрещают и не разрешают. Индустриальная практика — да; риск отзыва → нужен fallback на ключ пользователя |
| AniList | **да, аниме** | не нужен для чтения | — |
| Fribb / Anime-Lists / cedya77 AOD | **да, офлайн-маппинги** | не нужен (GitHub raw) | — |
| Wikidata | да, резолвер ID | не нужен (User-Agent) | — |
| Fanart.tv | да, логотипы (вторично) | project key + опционально personal | да, это их модель |
| Kitsu | резерв для аниме | не нужен для чтения | — |
| Jikan | резерв (MAL-данные без ключа) | не нужен | — |
| OMDb | только с ключом пользователя | ключ пользователя | нет (1000 запросов в день на ключ) |
| Trakt | только с аккаунтом пользователя | client id проекта + OAuth пользователя | client id — да, secret — серая зона |
| TVDB | только с PIN пользователя | ключ проекта + PIN | ключ — по договору с TVDB |
| MAL API v2 | только с аккаунтом пользователя | Client ID проекта + OAuth | соглашение требует держать Client ID в секрете, см. §3 |
| Shikimori | опционально (RU-аудитория) | без ключа для чтения, OAuth для списков | — |
| Simkl | опционально (трекинг) | client_id («not a secret» по их правилам) | да; client_secret — нет, рекомендуют PKCE или device flow |
| OpenSubtitles | (субтитры) | consumer key + логин пользователя | да |

---

## 3. Аниме-базы («IMDb для аниме»)

### 3.1 Источники

| База | API | Условия и лимиты | Что ценно |
|---|---|---|---|
| **AniList** | GraphQL `https://graphql.anilist.co`, чтение без авторизации, OAuth (implicit или code) для списков пользователя | Бесплатно для некоммерческого использования. Коммерческое бесплатно до $150 выручки в месяц, дальше лицензия. **Запрещены hoarding и массовый сбор данных**, использование API как бэкапа или хранилища, конкурирующие трекеры (если нет плотной синхронизации с AniList). Имя приложения не должно быть просто «AniList». Лимит **90 запросов в минуту, сейчас «degraded» — 30 в минуту** (в заголовках не отражено). [проверено через поиск по официальным docs] | Лучший API: названия romaji/english/native + synonyms, описания (EN), обложки (extraLarge/large/medium + цвет), баннеры, жанры и теги, **`idMal`**, студии, персонажи и сэйю, `airingSchedule` (когда выйдет следующая серия), `nextAiringEpisode`, сезонные чарты, trending, `externalLinks`, `streamingEpisodes`. |
| **MyAnimeList API v2** (официальный) | REST, `X-MAL-CLIENT-ID` или OAuth2 PKCE | Лицензионное соглашение: Client ID «secure, don't share with third parties», не хранить на сервере персональные данные и UGC пользователей, удалять контент в течение 24 часов по запросу, **скрейпинг запрещён**, числовых лимитов нет, могут начать брать плату с уведомлением. [проверено] https://myanimelist.net/static/apiagreement.html | Самая большая база и рейтинг MAL score. Для open source **неудобно**: Client ID в открытом коде формально противоречит соглашению. Делать «свой Client ID» пользователя — громоздко. |
| **Jikan** (неофициальный MAL API) | REST v4 `api.jikan.moe/v4`, без ключа, open source (MIT, можно поднять у себя) | около 3 запросов в секунду и 60 в минуту [не проверено, цифры из сторонних источников, в официальной документации описан 429]. Кэш на стороне Jikan (до 24 часов [не проверено]). Данные — скрейпинг MAL, то есть юридически «как MAL», только без ключа. | Удобный резерв для MAL score и MAL-специфики без OAuth. https://docs.api.jikan.moe/ |
| **Kitsu** | JSON:API `https://kitsu.io/api/edge` (алиас kitsu.app), чтение без ключа | Жёсткий лимит не опубликован, троттлинг и 429. | `/anime/{id}/mappings` — маппинги на MAL, AniList, AniDB, TVDB; эпизоды с thumbnail; streaming links. Резерв. |
| **AniDB** | HTTP API (XML, клиент надо зарегистрировать: `client`/`clientver`) и UDP API (логин, работа с файлами по ed2k) | Очень строгие правила: не чаще **1 запроса в 2 секунды**, обязательный кэш (одно аниме не чаще раза в сутки), бан IP за превышение (пользователи сообщают о бане после ~100–250 запросов в сутки). **Дамп названий `anime-titles.xml.gz` (или .dat) — не чаще раза в сутки**, иначе бан. [не проверено, вики AniDB вернула 403; цифры по вики-цитатам в сторонних клиентах и на форуме FileBot] https://wiki.anidb.net/HTTP_API_Definition | Эталонная структура эпизодов (регулярные, S-спецвыпуски, OP/ED), точные даты, многоязычные названия (включая pl, ru, uk) из дампа. **Не годится для прямого доступа с тысяч клиентов** — ID и названия берём из дампа или маппингов. |
| **Shikimori** | REST v1/v2 + GraphQL `/api/graphql`, чтение без OAuth с обязательным `User-Agent` с именем приложения | около **5 запросов в секунду и 90 в минуту** [не проверено, сторонние обёртки]. Домены менялись (`shikimori.one` → `shikimori.io`). | **Русские названия и описания**, ID совпадают с MAL. Полезно при локализации на ru и uk. |
| **Simkl** | REST, `client_id` бесплатно без одобрения | 10 GET в секунду, 1 POST в секунду на client_id и токен; бесплатно до $150 выручки в месяц; атрибуция ссылкой на страницу тайтла в Simkl; trending и calendar отдаются JSON-файлами через CDN (не тратят квоту). [проверено] https://api.simkl.org/api-rules | Трекер фильмов, сериалов и аниме с ID-маппингами (simkl, imdb, tmdb, tvdb, mal, anidb…). Альтернатива Trakt без VIP-ограничений. |

### 3.2 Датасеты с маппингом ID

| Датасет | Что внутри | Статус (на 2026-11-13) | Лицензия |
|---|---|---|---|
| **manami-project/anime-offline-database** | Около 41.5 тыс. тайтлов: `sources` (URL на MAL, AniList, AniDB, Kitsu, anime-planet, anisearch, Simkl, LiveChart, ANN, AnimeCountdown), type, episodes, status, animeSeason, picture, synonyms, relatedAnime, tags, studios, score. **Без TMDB и IMDb.** | **Заархивирован 2026-07-04**, последний релиз `2026-27` [проверено через GitHub API] | ODbL 1.0 + DbCL 1.0 |
| **cedya77/anime-offline-database** | Продолжение того же датасета (пайплайн `cedya77/modb-app`), засеян финальным релизом manami | Активен, обновлён 2026-11-11, неделя 36 [проверено] | ODbL (наследуется [не проверено]) |
| **Fribb/anime-lists** | `anime-list-full.json`: склейка AOD + ScudLee: `anidb_id, anilist_id, mal_id, kitsu_id, anime-planet_id, anisearch_id, livechart_id, simkl_id, `**`themoviedb_id`, `thetvdb_id`, `imdb_id`**, type | Активен, обновлён 2026-11-12 | файла лицензии нет |
| **Anime-Lists/anime-lists** (ScudLee) | `anime-list-master.xml`: на каждый AniDB ID — `tvdbid`, `defaulttvdbseason` (номер сезона или `a` = absolute), `episodeoffset`, `tmdbid`, `imdbid` и **`<mapping-list>`** (по-эпизодная перенумерация AniDB→TVDB, включая спецвыпуски). Плюс `anime-movieset-list.xml`. | Активен, обновлён 2026-11-13 | файла лицензии нет |
| **Kometa-Team/Anime-IDs** | `anime_ids.json`: AniDB → tvdb, imdb, mal, anilist, tmdb_movie, tmdb_show, генерируется ежедневно | Активен | MIT |

https://github.com/manami-project/anime-offline-database, https://github.com/cedya77/anime-offline-database, https://github.com/Fribb/anime-lists, https://github.com/Anime-Lists/anime-lists, https://github.com/Kometa-Team/Anime-IDs

У Fribb и Anime-Lists нет файла лицензии, поэтому юридически условия неясны. Данные — факты (соответствия ID), и ими пользуются Kometa, Jellyfin-плагины и Plex-агенты. Рекомендация: скачивать в рантайме с GitHub raw (или со своего зеркала в GitHub Releases reel), а не вшивать в репозиторий, и указать источники в Credits.

### 3.3 Проблема нумерации эпизодов

Одно и то же аниме устроено в разных базах по-разному:

- **AniDB, MAL, AniList, Kitsu** заводят **отдельную запись на каждый сезон или кур** («Shingeki no Kyojin», «… Season 2», «… The Final Season Part 2» — разные ID), нумерация внутри записи с 1. Спецвыпуски (OVA, рекапы) — отдельные записи или S-эпизоды.
- **TVDB** — один сериал с сезонами (как на ТВ на Западе), плюс у эпизодов есть **absolute number** (сквозной 1…N) и альтернативные порядки.
- **TMDB** — один сериал с сезонами, разбиение решают редакторы (у One Piece TMDB-сезоны соответствуют сюжетным аркам, а не японским сезонам). Альтернативные разбиения лежат в **episode groups** (absolute, story arc и т. д.), но это ручной контент, и он есть не у всех.
- **Релизы** (торренты фансаба) часто нумеруют **абсолютно** (`[Group] One Piece - 1085`) или по названию сезона и куру (`Title S2 - 05` или `Title 2nd Season - 05`). Бывает, что абсолют в релизе перезапускается с каждым сезоном.

Пример: «Attack on Titan Final Season Part 2», эпизод 1 = AniDB-запись X, эп. 1 = TVDB S04E17 = абсолютный №76 = TMDB S04E17 (или другой номер в зависимости от редакции).

Как решают другие:
- **Sonarr:** каноническая база — TVDB. Для аниме есть отдельный тип серии «Anime», который матчит релизы по **absolute number**. Расхождения с релиз-группами чинят через **TheXEM** (`thexem.info`, бывший `thexem.de`): ручные маппинги scene↔TVDB (SxxExx, absolute, full). Ошибки правят на TheXEM, а не в Sonarr. https://wiki.servarr.com/sonarr/xem-guide
- **Jellyfin:** по умолчанию TMDB, и аниме из-за этого часто матчится плохо. Решения: **Shokofin** (Shoko Server определяет файл по хэшу в AniDB, группирует по структуре AniDB, описания из AniDB, TVDB или TMDB) или AnimeMultiSource (AniList, AniDB, Jikan + маппинги Fribb). https://github.com/ShokoAnime/Shokofin
- **Plex и Kometa / Hama:** AniDB как основа + ScudLee `anime-list-master.xml` для перевода в TVDB-сезоны.
- **Stremio:** ID эпизода `tt…:season:episode` (IMDb/Cinemeta-структура). Аниме-аддоны (Kitsu addon и AIOMetadata) используют свои ID (`kitsu:ID:ep`) и маппинги Fribb для перевода в IMDb/TMDB-сезоны.

**Вывод для reel:** хранить у эпизода **несколько координат одновременно** — `(season, episode)` в TMDB-порядке, `absolute_number`, плюс ссылки на аниме-записи (`anidb_id` и `anilist_id` записи-кура + номер внутри неё). Конвертацию делать по таблице ScudLee `mapping-list` или `episodeoffset`, а при её отсутствии — по TMDB episode group типа «Absolute». Сопоставление с торрент-релизом позже будет искать по любой из координат.

---

## 4. Рекомендуемая архитектура для reel

### 4.1 Источники

**По умолчанию (без действий пользователя):**
1. **TMDB** — каталог фильмов и сериалов (включая аниме-сериалы и фильмы), картинки (постеры, фоны, логотипы, кадры), актёры, trending и discover, поиск, локализация, `external_ids`. Ключ проекта в сборке плюс настройка «Свой ключ TMDB».
2. **AniList** — аниме-слой: разделы «Аниме», сезонные чарты, расписание выхода серий (`nextAiringEpisode`), названия romaji и native, теги, AniList score. Без ключа, с учётом 30 запросов в минуту: батчить GraphQL (до 50 ID в одном `Page { media(id_in: [...]) }`) и агрессивно кэшировать. Массово каталог не выкачивать (запрет hoarding).
3. **Маппинги офлайн:** Fribb `anime-list-full.json` (AniList, MAL, AniDB, Kitsu ↔ TMDB, TVDB, IMDb) + ScudLee `anime-list-master.xml` (эпизодные маппинги). Ядро скачивает их раз в неделю (ETag и If-Modified-Since), они живут в SQLite.
4. **Wikidata** — запасной резолвер ID и источник локализованных названий там, где у TMDB нет перевода.
5. **Fanart.tv** (ключ проекта) — второй источник логотипов и clearart, когда у TMDB нет `logo`.

**Только если пользователь добавил свой ключ или аккаунт:**
- **OMDb** — рейтинги IMDb, Rotten Tomatoes, Metacritic в карточке.
- **Trakt** или **Simkl** — синхронизация просмотров, watchlist, скробблинг (device code flow на ТВ).
- **TVDB** (PIN подписчика) — альтернативный порядок эпизодов.
- **MAL** (OAuth пользователя) или **Shikimori** — синхронизация аниме-списка. Shikimori также как источник ru-описаний, когда добавим русский.
- **Fanart.tv personal key** — свежие картинки быстрее.

**Не используем:** скрейпинг IMDb, MAL и AniDB, прямой AniDB HTTP API с клиентов, датасеты IMDb в сборке.

### 4.2 Где живёт клиент метаданных

**В Rust-ядре**, по причинам:
- одна реализация на все 4 платформы (Tizen, macOS, Android, iOS), без CORS и с нормальным HTTP (reqwest или hyper, уже есть tokio);
- кэш в SQLite и на диске, офлайн-режим, дедупликация запросов, общий rate limiter на источник (governor или token bucket) — это всё задачи ядра;
- ключи и токены (TMDB пользователя, OAuth Trakt) хранятся в ядре (Keychain, Keystore или файл на Tizen), в UI не попадают;
- позже матчинг метаданных с торрент-релизами тоже будет в ядре, рядом с librqbit.

**UI (TSX)** вызывает `async` методы NSH-модуля (`Metadata.title(id, lang)`, `Metadata.shelf("trending", lang)`, `Metadata.search(q, lang)`) и получает нормализованные модели. В `app/data.ts` отмечено, что Rust-модули не видят язык UI. Поэтому **язык передаётся параметром** в каждый вызов, а ядро возвращает строки уже для этого языка с fallback-цепочкой (`pl-PL → pl → en → original`). Форматирование (длительность, даты) остаётся в TS.

### 4.3 Кэш

**SQLite** (`rusqlite` с `bundled`, один файл в app data):
- `title`, `season`, `episode`, `person`, `credit`, `image`, `rating`, `external_id`, `localized_text`, `genre` — нормализованные таблицы (схема по модели ниже).
- `http_cache(provider, request_key, etag, last_modified, fetched_at, expires_at, body BLOB)` — сырой кэш ответов для повторной нормализации без сети.
- `id_map(kind, source, source_id, target, target_id, origin)` — маппинги (Fribb, ScudLee, Wikidata, TMDB external_ids), с полем `origin` для отладки.
- `shelf(id, lang, fetched_at, items JSON)` — подборки (trending, popular, airing).
- FTS5-индекс по названиям и синонимам для **офлайн-поиска** по уже известному каталогу; онлайн-поиск идёт в TMDB и AniList и сливается с локальным.

**TTL (ориентиры):**

| Данные | TTL |
|---|---|
| Trending, popular, airing (подборки) | 6–12 ч |
| Карточка выходящего сериала, `nextAiringEpisode` | 12–24 ч |
| Карточка завершённого тайтла, сезоны, эпизоды, каст | 14–30 дней |
| Рейтинги (TMDB, OMDb, AniList) | 3–7 дней |
| Маппинги ID (Fribb, ScudLee) | 7 дней |
| Конфигурация TMDB (`/configuration`, жанры) | 7 дней |
| **Максимум для TMDB по Terms** | **6 месяцев** — после этого удалить или перезапросить |

Стратегия **stale-while-revalidate**: сразу отдать из кэша, в фоне обновить и отправить UI событие. Офлайн показываем всё, что есть, с пометкой.

**Картинки:** дисковый кэш по ключу `sha256(url)`, LRU с лимитом размера (на Tizen маленький, около 200–300 МБ, на остальных около 1 ГБ, настраивается). Запрашивать размер под экран: на ТВ 1080p постер `w342` или `w500`, фон `w1280`, логотип `w500`; на телефоне меньше. Для плиток хранить заранее вычисленный доминантный цвет (AniList отдаёт `coverImage.color`, для TMDB считаем сами), чтобы сразу рисовать плашку, как наши `ink` и `paper`.

### 4.4 Абстракция провайдеров

```rust
/// Что умеет источник; ядро выбирает провайдеров по capability и приоритету.
pub enum Capability { Search, Details, Seasons, Episodes, Credits, Images, Logos, Ratings, Trending, Airing, Translations, IdLookup, UserSync }

#[async_trait]
pub trait MetadataProvider: Send + Sync {
    fn id(&self) -> ProviderId;                    // Tmdb, AniList, Omdb, Fanart, Wikidata, Tvdb, Kitsu, Jikan, Trakt, Simkl, Mal, Shikimori
    fn capabilities(&self) -> &[Capability];
    fn requires_user_credentials(&self) -> bool;   // OMDb, Trakt, TVDB PIN…
    fn attribution(&self) -> Attribution;          // текст, логотип, ссылка — для экрана Credits и бейджей

    async fn search(&self, q: &SearchQuery, cx: &Cx) -> Result<Vec<TitleStub>>;
    async fn title(&self, id: &ProviderRef, cx: &Cx) -> Result<TitlePatch>;
    async fn season(&self, id: &ProviderRef, n: u32, cx: &Cx) -> Result<SeasonPatch>;
    async fn images(&self, id: &ProviderRef, cx: &Cx) -> Result<Vec<Image>>;
    async fn ratings(&self, id: &ProviderRef, cx: &Cx) -> Result<Vec<Rating>>;
    async fn shelf(&self, kind: ShelfKind, cx: &Cx) -> Result<Vec<TitleStub>>;
    async fn resolve_ids(&self, known: &ExternalIds, cx: &Cx) -> Result<ExternalIds>;
}
```

- Провайдер возвращает **патчи** (`TitlePatch` со своим `source`), а слой **merge** собирает итоговый `Title` по правилам приоритета **для каждого поля** (например, для аниме: названия и теги из AniList, фон и логотип из TMDB, затем Fanart; описание на языке пользователя из TMDB, затем AniList (EN), затем Shikimori (RU)). Правила — явная таблица в конфиге, не цепочка `a ?? b` в коде. Рейтинги не сливаются, а хранятся списком с источником.
- `Cx` несёт язык, регион (PL), HTTP-клиент с rate limiter для этого провайдера, доступ к кэшу и учётным данным.
- Отключение или замена источника — флаг в настройках. Отзыв ключа TMDB выглядит как `ProviderError::Unauthorized`, и UI просит ввести свой ключ.

### 4.5 Нормализованная модель данных

```rust
/// Наш стабильный ID: ULID, который не зависит от внешних баз (TMDB-ID у фильма и сериала пересекаются,
/// у аниме-кура может не быть TMDB-записи).
pub struct TitleId(pub Ulid);

pub enum TitleKind { Movie, Series, Miniseries, Special, Short }
/// Аниме — не отдельный тип, а признак: фильм или сериал + происхождение.
pub enum AnimeFormat { Tv, TvShort, Movie, Ova, Ona, Special, Music }

pub struct Title {
    pub id: TitleId,
    pub kind: TitleKind,
    pub anime: Option<AnimeInfo>,          // Some, если тайтл — аниме
    pub ids: ExternalIds,
    pub original_title: String,
    pub original_language: Option<LanguageTag>,   // "ja", "en"
    pub titles: Localized<String>,                // по языкам
    pub aliases: Vec<AltTitle>,                   // синонимы, romaji, AKA — для поиска и матчинга релизов
    pub tagline: Localized<String>,
    pub overview: Localized<String>,
    pub genres: Vec<GenreId>,                     // наш справочник; маппинг с TMDB и AniList
    pub tags: Vec<Tag>,                           // AniList tags, TMDB keywords
    pub release: ReleaseInfo,
    pub runtime_minutes: Option<u32>,             // фильм или типичная длительность эпизода
    pub status: Option<TitleStatus>,              // Announced | Airing | Ended | Canceled | Released
    pub countries: Vec<CountryCode>,
    pub studios: Vec<Company>,                    // студии, сети (network)
    pub certifications: Vec<Certification>,       // { country: "PL", value: "16" }
    pub images: Vec<Image>,
    pub ratings: Vec<Rating>,
    pub credits: Vec<Credit>,                     // для сериала — основной состав
    pub season_count: Option<u32>,
    pub episode_count: Option<u32>,
    pub next_episode: Option<EpisodeRef>,         // AniList nextAiringEpisode / TMDB next_episode_to_air
    pub related: Vec<Relation>,                   // сиквел, приквел, спин-офф, кур — аниме-цепочки
    pub provenance: Vec<FieldSource>,             // какое поле из какого источника и когда
    pub fetched_at: Timestamp,
}

pub struct AnimeInfo {
    pub format: AnimeFormat,
    pub season: Option<(AnimeSeason, u16)>,       // (Winter|Spring|Summer|Fall, год)
    /// Записи аниме-баз, из которых состоит этот тайтл (у TMDB-сериала их может быть несколько: по курам).
    pub entries: Vec<AnimeEntry>,
}
pub struct AnimeEntry {
    pub anilist: Option<u32>, pub mal: Option<u32>, pub anidb: Option<u32>, pub kitsu: Option<u32>,
    pub tmdb_season: Option<u32>,                 // какой TMDB-сезон соответствует (из ScudLee/Fribb)
    pub episode_offset: i32,                      // ScudLee episodeoffset
    pub episodes: Option<u32>,
}

#[derive(Default)]
pub struct ExternalIds {
    pub imdb: Option<String>,        // "tt0944947"
    pub tmdb: Option<TmdbId>,        // { kind: Movie|Tv, id: 1399 } — у TMDB ID уникален только внутри типа
    pub tvdb: Option<u32>,
    pub wikidata: Option<String>,    // "Q23572"
    pub anilist: Option<u32>,
    pub mal: Option<u32>,
    pub anidb: Option<u32>,
    pub kitsu: Option<u32>,
    pub trakt: Option<u32>,
    pub simkl: Option<u32>,
    pub shikimori: Option<u32>,      // как правило = mal, но храним отдельно
}

pub struct Localized<T> { pub values: BTreeMap<LanguageTag, T> }  // "en", "pl", "pl-PL", "ja-Latn" (romaji)
pub struct AltTitle { pub text: String, pub lang: Option<LanguageTag>, pub kind: AltTitleKind /* Official|Synonym|Romaji|Native|Short */, pub source: ProviderId }

pub struct ReleaseInfo {
    pub first_air_or_release: Option<Date>,
    pub last_air: Option<Date>,
    pub year: Option<u16>,
    pub by_country: Vec<RegionalRelease>,          // { country, date, kind: Theatrical|Digital|Physical|Tv, certification }
}

pub struct Season {
    pub title_id: TitleId,
    pub number: u32,                               // TMDB-порядок; 0 = specials
    pub name: Localized<String>,
    pub overview: Localized<String>,
    pub air_date: Option<Date>,
    pub episode_count: u32,
    pub images: Vec<Image>,
    pub ids: ExternalIds,                          // tmdb season id, tvdb season id, anilist/anidb записи-кура
}

pub struct Episode {
    pub id: EpisodeId,                             // ULID
    pub title_id: TitleId,
    pub season: u32,                               // координата 1: TMDB season/episode
    pub number: u32,
    pub absolute: Option<u32>,                     // координата 2: абсолютный номер
    pub anime_entry: Option<(AnimeEntryRef, u32)>, // координата 3: (AniDB/AniList запись, номер внутри)
    pub kind: EpisodeKind,                         // Regular | Special | Recap | Ova | Movie
    pub name: Localized<String>,
    pub overview: Localized<String>,
    pub air_date: Option<DateTime>,
    pub runtime_minutes: Option<u32>,
    pub still: Option<Image>,
    pub ratings: Vec<Rating>,
    pub ids: ExternalIds,                          // imdb эпизода (tt…), tmdb episode id, tvdb episode id
}

pub struct Person {
    pub id: PersonId,
    pub name: String,
    pub names: Localized<String>,                  // для японских имён: native, romaji
    pub ids: PersonIds,                            // imdb "nm…", tmdb, anilist staff, mal people, wikidata
    pub profile: Option<Image>,
    pub birthday: Option<Date>, pub deathday: Option<Date>,
}
pub struct Credit {
    pub person: PersonId,
    pub role: CreditRole,                          // Cast { character, voice: bool, lang: Option<LanguageTag> } | Crew { department, job }
    pub order: u32,
    pub episodes: Option<u32>,                     // для сериалов (TMDB aggregate_credits)
}

pub enum ImageKind { Poster, Backdrop, Logo, ClearArt, Banner, Still, Profile, Thumb }
pub struct Image {
    pub kind: ImageKind,
    pub source: ProviderId,
    pub path: String,                              // путь у источника ("/abc.jpg"), не полный URL
    pub width: u32, pub height: u32,
    pub aspect: f32,
    pub lang: Option<LanguageTag>,                 // None = без текста (удобно для фонов)
    pub vote: Option<f32>,                         // для выбора лучшего
    pub dominant_color: Option<Rgb>,
    pub sizes: &'static [ImageSize],               // какие размеры умеет CDN (w342, w500, original…)
}

pub struct Rating {
    pub source: RatingSource,                      // Tmdb | Imdb(via Omdb) | AniList | Mal | RottenTomatoes | Metacritic | Trakt | Simkl | Shikimori
    pub value: f32,                                // в родной шкале источника
    pub scale: f32,                                // 10.0, 100.0, 5.0 — для нормализации в UI
    pub votes: Option<u64>,
    pub fetched_at: Timestamp,
}

pub enum ShelfKind { Trending { window: Day|Week, media: All|Movie|Tv }, Popular, TopRated, AiringNow, AnimeSeason(AnimeSeason, u16), AnimeTrending, Upcoming, Custom(String) }
```

**Как позже привяжется проигрываемый релиз** (только поля, без реализации):

```rust
pub struct Release {
    pub id: ReleaseId,
    pub target: ReleaseTarget,                     // Title(TitleId) | Episode(EpisodeId) | Season(TitleId, u32) | Range { title, from: EpisodeCoord, to: EpisodeCoord }
    pub matched_by: MatchMethod,                   // ExternalId | Name+Year | AbsoluteNumber | SeasonEpisode | Manual
    pub confidence: f32,
    pub info_hash: Option<String>, pub magnet: Option<String>,
    pub file_index: Option<u32>,                   // файл внутри торрента
    pub file_name: Option<String>,
    pub size_bytes: Option<u64>,
    pub quality: Option<Quality>,                  // 2160p/1080p…, HDR, кодек
    pub audio: Vec<AudioTrackInfo>, pub subtitles: Vec<SubtitleInfo>,
    pub release_group: Option<String>,
    pub episode_coords: Vec<EpisodeCoord>,         // распарсенные из имени: S01E05 | abs 1085 | "2nd Season - 05"
    pub added_at: Timestamp,
}
```

Ключевое решение: `Episode` хранит три координаты, `Release` ссылается на наш `EpisodeId` и сохраняет координаты, распознанные из имени. Тогда перенумерация в TMDB не ломает уже привязанные релизы.

### 4.6 Стратегия маппинга ID

1. **Фильмы и сериалы:** точка входа — TMDB (trending, поиск). `append_to_response=external_ids` сразу даёт `imdb_id`, `tvdb_id`, `wikidata_id`. По IMDb ID → TMDB: `/find/{tt}?external_source=imdb_id`.
2. **Аниме из AniList → TMDB:** `anilist_id` → Fribb `anime-list-full.json` → `themoviedb_id` (+ `thetvdb_id`, `imdb_id`, `anidb_id`) → ScudLee XML по `anidb_id` → `defaulttvdbseason`, `episodeoffset`, `mapping-list`. Если TMDB-записи в маппинге нет: Wikidata (P8729 → P4983 или P4947), затем `/find` по TVDB ID, затем поиск в TMDB по `original_title` + год + `with_original_language=ja` с порогом уверенности. Иначе тайтл живёт только на данных AniList (это нормально).
3. **Аниме из TMDB → AniList:** обратный индекс по Fribb (`themoviedb_id` → список `anilist_id` по курам, упорядоченных по `animeSeason`). Один TMDB-сериал = несколько `AnimeEntry`.
4. **Резерв:** Kitsu `/anime/{id}/mappings`, cedya77 AOD (MAL↔AniList↔AniDB↔Kitsu по `sources`).
5. Все разрешённые связи пишутся в `id_map` с `origin` (fribb, scudlee, wikidata, tmdb, heuristic) и `confidence`. Эвристические связи UI может пометить, а пользователь — исправить вручную («это не тот тайтл»). Ручные исправления имеют высший приоритет.
6. **Конфликты не сливаются молча.** Если Fribb и Wikidata дают разные TMDB ID, связь хранится с обоими origin, выбор идёт по таблице приоритетов, в лог пишется предупреждение.

### 4.7 Атрибуция и юридические заметки

- **TMDB:** экран About/Credits с логотипом TMDB (из официального набора, меньше логотипа reel) и текстом *«This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.»* Кэш не дольше 6 месяцев. Не обучать ИИ на данных. Не раздавать дамп TMDB. Приложение должно оставаться некоммерческим (без рекламы и платных функций), иначе нужен договор. Отдельно оценить риск: при позиционировании как «торрент-стример» TMDB может отозвать ключ, поэтому в настройках сразу есть поле «Свой ключ TMDB», а ключ проекта лучше задавать при сборке (env или CI secret), а не держать в репозитории открытым текстом. Это не делает его секретом в бинарнике, но исключает тривиальный копипаст из GitHub.
- **IMDb:** не скрейпить, не вшивать датасеты, не использовать логотип. IMDb ID — да. Рейтинг IMDb — только через OMDb с ключом пользователя, с пометкой источника.
- **OMDb:** CC BY-NC 4.0, в Credits «Ratings via OMDb API».
- **AniList:** не использовать «AniList» в названии; не выкачивать каталог массово; держать запросы под 30 в минуту. Ссылка на страницу тайтла в AniList — хорошая практика.
- **Fanart.tv, TVDB, Simkl, Trakt:** ссылки-атрибуции (Simkl требует ссылку на страницу конкретного тайтла и упоминание Simkl в заголовке trending-полки).
- **MAL:** только через официальный API и OAuth пользователя, Client ID держать вне репозитория. Jikan — неофициальный, юридически это скрейпинг MAL; использовать как резерв осознанно.
- **AniDB:** никаких прямых запросов с клиентов. Данные AniDB попадают в reel только через маппинги (ScudLee, Fribb) и, при необходимости, через дамп названий, который скачивается не чаще раза в сутки со своего зеркала.
- **Маппинги:** AOD под ODbL — при раздаче производной базы (например, своего зеркала) нужна атрибуция и share-alike. У Fribb и ScudLee лицензии нет: указать в Credits и не выдавать за своё.
- **Google Play:** метаданные сами по себе проблем не создают. Политики Play касаются функции воспроизведения торрентов, а она вне рамок этого документа.

---

## 5. Порядок внедрения (предложение)

1. Rust-модуль `metadata`: HTTP-клиент с per-provider rate limit, SQLite-схема, кэш картинок, провайдер TMDB (trending, details, season, images с logos, search, external_ids). Экран Credits с атрибуцией TMDB.
2. Модели из §4.5 → NSH-декларации для TS; замена демо-`films` в `app/data.ts` на полки из ядра (демо-каталог оставить как офлайн-fallback).
3. Аниме: загрузчик Fribb + ScudLee в `id_map`, провайдер AniList (батч-запросы), merge-правила для аниме, три координаты эпизодов.
4. Опциональные провайдеры: OMDb (рейтинги), Fanart.tv (логотипы), Wikidata (резолвер), затем Trakt и Simkl (синхронизация).

---

## Источники

- IMDb datasets: https://data.imdb.com/non-commercial-datasets/
- IMDb Conditions of Use: https://www.imdb.com/conditions
- IMDb на AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-yeuyizioqmfsy
- TMDB API Terms: https://www.themoviedb.org/api-terms-of-use
- TMDB FAQ: https://developer.themoviedb.org/docs/faq
- TMDB rate limiting: https://developer.themoviedb.org/docs/rate-limiting
- TVDB: https://thetvdb.com/api-information, https://thetvdb.com/subscribe, https://github.com/thetvdb/v4-api
- OMDb: https://www.omdbapi.com/apikey.aspx
- Trakt: https://trakt.docs.apiary.io/, https://alternativeto.net/news/2025/2/trakt-tv-has-set-stricter-limits-for-free-users-and-raised-vip-subscription-prices-by-100-
- Fanart.tv: https://fanart.tv/get-an-api-key/, https://medium.com/fanart-tv/what-are-fanart-tv-personal-api-keys-472f60222856
- OpenSubtitles: https://opensubtitles.tawk.help/article/about-the-api
- Wikidata (свойства): https://www.wikidata.org/wiki/Property:P345, P4947, P4983, P4835, P8729, P4086, P5646, P11495
- AniList: https://docs.anilist.co/guide/rate-limiting, https://anilist.gitbook.io/anilist-apiv2-docs/docs/guide/terms-of-use
- MAL API agreement: https://myanimelist.net/static/apiagreement.html
- Jikan: https://docs.api.jikan.moe/, https://github.com/jikan-me/jikan-rest
- Kitsu: https://hummingbird-me.github.io/api-docs
- AniDB: https://wiki.anidb.net/HTTP_API_Definition, https://www.filebot.net/forums/viewtopic.php?p=51839
- Shikimori: https://shikimori.io/api/doc/graphql
- Simkl: https://api.simkl.org/api-rules
- anime-offline-database: https://github.com/manami-project/anime-offline-database (архив), https://github.com/cedya77/anime-offline-database
- Fribb/anime-lists: https://github.com/Fribb/anime-lists
- Anime-Lists (ScudLee): https://github.com/Anime-Lists/anime-lists
- Kometa Anime-IDs: https://github.com/Kometa-Team/Anime-IDs
- Sonarr и TheXEM: https://wiki.servarr.com/sonarr/xem-guide
- Shokofin: https://github.com/ShokoAnime/Shokofin
- Kodi: https://kodi.wiki/view/Add-on:The_Movie_Database
- Stremio Cinemeta: https://github.com/Stremio/stremio-addons/blob/master/docs/tutorial/using-cinemeta.md
- Lampa: https://deepwiki.com/yumata/lampa-source/5.1-tmdb-api-integration
