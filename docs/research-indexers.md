# reel: как подключать индексаторы торрентов и есть ли «один агрегатор»

Дата исследования: 13.11.2026. Только исследование, реализации пока нет. Это общая информация, а не юридическая консультация.

Документ продолжает `design/research-plugin-model.md` и опирается на его выводы: в ядре нет ни одного предустановленного индексатора, источники добавляет сам пользователь, в репозитории (включая историю git) нет адресов пиратских индексаторов и нет формулировок вроде «смотри бесплатно». Метаданные (TMDB/IMDb) разобраны отдельно в `docs/research-metadata.md` и здесь не повторяются: отсюда берутся только идентификаторы `imdb_id`, `tmdb_id`, номер сезона и эпизода.

Гигиена этого файла: адресов трекеров и публичных инстансов индексаторов здесь нет. Названия ПО (Jackett, Prowlarr и т.п.) и протоколов приводятся, в примерах используются только Internet Archive, Linux-дистрибутивы или заглушка `https://indexer.example`.

Пометки: **[проверено]** — смотрел первичный документ, исходник или GitHub/crates.io API. **[вторично]** — README или пересказ без проверки кода. **[не уверен]** — подтверждения не нашёл.

---

## 0. Коротко

1. **Единого агрегатора «для всех» нет.** Есть программы-агрегаторы, которые пользователь ставит у себя: **Prowlarr** и **Jackett** (сводят десятки индексаторов в один API), **BitMagnet** (сам строит индекс, обходя DHT). Все три отдают результаты по **Torznab**. Поэтому Torznab и есть фактический общий знаменатель.
2. **Основная интеграция для reel: клиент Torznab в Rust-ядре** («Generic Torznab» + помощники формы URL для Jackett и Prowlarr). Он покрывает Jackett, Prowlarr (по индексаторам), BitMagnet, NZBHydra2 (торрентовая часть) и любые совместимые сервисы. Поиск идёт по `imdbid`/`tmdbid` + `season`/`ep` из наших метаданных.
3. **Вторая интеграция: нативный клиент Prowlarr** (`GET /api/v1/search`). В Prowlarr нет одного Torznab-эндпоинта «по всем индексаторам», а JSON-поиск по всем есть и понимает ID-токены `{imdbid:…}{season:…}{episode:…}`.
4. **Третья, опциональная: клиент протокола аддонов Stremio** (только ресурс `stream`). Self-hosted аддоны (Comet, MediaFusion, AIOStreams, Jackettio, KnightCrawler) сами опрашивают Jackett, Prowlarr или BitMagnet и уже отдают `infoHash` + `fileIdx` по IMDb-ID эпизода. Для дома без сервера это единственный способ получить поиск, но адрес аддона вводит только пользователь.
5. **Внутри приложения агрегатор не запускается.** На Tizen, iOS и Android TV нельзя поднять Jackett или Prowlarr (.NET, отдельный процесс), а DHT-краулер вроде BitMagnet требует Postgres, часы обхода и гигабайты. На macOS пользователь может поставить Prowlarr или Jackett локально рядом с reel.
6. **Семья «только с телевизором»** получает: (а) воспроизведение magnet и .torrent, отправленных с телефона (QR или локальная сеть); (б) легальный встроенный источник Internet Archive; (в) Torznab/Prowlarr на любом домашнем устройстве (NAS, ПК, Raspberry Pi), если оно появится; (г) URL аддона, введённый пользователем. Настройка источников делается с телефона через локальную страницу ядра, а не пультом.
7. **Чего не делать:** движок определений трекеров (Cardigann-YAML) внутри reel, поиск через базу TorrServer, общий облачный кэш результатов, debrid-интеграции, витрина или «рекомендованные» источники.

---

## 1. Программы-агрегаторы, которые пользователь запускает сам

### 1.1 Сводная таблица

| ПО | Лицензия | Как ставится | API наружу | На самом устройстве с reel? | Семье только с TV |
|---|---|---|---|---|---|
| **Jackett** | GPL‑2.0 [проверено] | Win, Linux x64/ARM, macOS 13+, Docker (LinuxServer.io) [проверено, README] | Torznab (+ TorrentPotato); агрегатный Torznab `/api/v2.0/indexers/all/results/torznab` и фильтры `tag:`, `lang:`, `status:healthy`; JSON `/api/v2.0/indexers/{filter}/results` (его использует Lampa) | macOS — да, рядом; Android — только неофициально через Termux; Tizen/iOS — нет | нужен NAS или ПК |
| **Prowlarr** | GPL‑3.0 [проверено] | Win, Linux, macOS, Docker, пакеты NAS [вторично] | Torznab/Newznab **на каждый индексатор** `/{id}/api`; REST `/api/v1/search` (агрегирует), `/api/v1/indexer`; ключ `X-Api-Key` или `apikey` [проверено, openapi.json] | macOS — да; остальное — нет | нужен NAS или ПК |
| **BitMagnet** | MIT [проверено] | Docker Compose + Postgres 16; порты 3333 (API/UI) и 3334 TCP/UDP (DHT) [проверено, docs] | Torznab `/torznab`, GraphQL `/graphql`; классификатор с обогащением из TMDB | нет: постоянный краулер и база | нужен постоянно включённый сервер; статус **alpha**, нет API-ключей [проверено, сайт] |
| **NZBHydra2** | GPL‑3.0 [проверено] | Java, Docker, Win/Linux/macOS [вторично] | Newznab и Torznab поверх Newznab-индексаторов и Jackett | нет | для Usenet; reel торренты, ценность низкая |
| **TorrServer** | GPL‑3.0 [проверено] | бинарники, Docker, Android (MatriX) | `/torznab/search/*query` (проксирует настроенные пользователем Torznab-URL), `/search/*query` (поиск по собственной базе дампа одного трекера, которую раздаёт автор) [проверено, `server/web/api/route.go`] | Android — да, отдельным приложением | Torznab-прокси повторяет то, что reel сделает сам; встроенный поиск по базе **не использовать** (см. прошлый отчёт, §2) |
| **Lampa, раздел «Парсер»** | GPL‑2.0 | — (это клиент) | клиент к Jackett (JSON `/api/v2.0/indexers/all|status:healthy/results?Query=…&Category[]=2000|5000`), Prowlarr (`/api/v1/search?type=search|tvsearch&categories=…`), TorrServer [проверено, `src/core/api/sources/parser.js`] | — | показывает, что клиент ищет **по тексту** «название + год», а не по ID; reel может лучше |
| **qBittorrent search plugins** | GPL‑2.0 (репо плагинов) [проверено] | плагины на Python внутри qBittorrent | WebUI API `/api/v2/search/start?pattern=&plugins=&category=`, `/search/status`, `/search/results` (`fileName`, `fileUrl`, `fileSize`, `nbSeeders`, `nbLeechers`, `descrLink`) [вторично, wiki WebUI API] | нет (нужен qBittorrent + Python) | нет; низкий приоритет |
| **Stremio-аддоны (self-hosted)** | см. §1.6 | Docker | протокол аддонов Stremio: `stream` по `tt…:S:E` | нет | можно на NAS; либо удалённый аддон по URL |

### 1.2 Jackett

- [Jackett/Jackett](https://github.com/Jackett/Jackett): GPL‑2.0, около 16.4k звёзд, активно развивается [проверено, GitHub API]. Это прокси, который «translates queries from applications» в запросы к конкретным трекерам по YAML-определениям (588 файлов в `src/Jackett.Common/Definitions/`) [проверено].
- **Torznab** [проверено, README]:
  - `GET {base}/api/v2.0/indexers/{indexer}/results/torznab/api?apikey=…&t=caps`
  - режимы: `t=search` (`q`), `t=tvsearch` (`q, season, ep, imdbid, tvdbid, rid, tmdbid, tvmazeid, traktid, doubanid, year, genre`), `t=movie` (`q, imdbid, tmdbid, traktid, doubanid, year, genre`).
  - `{indexer}=all` опрашивает все настроенные индексаторы и склеивает ответ (ограничение 1000 результатов, только общие категории). Вместо `all` можно передать фильтр: `status:healthy`, `test:passed`, `lang:en`, `tag:…`, с операторами `!`, `+`, `,`.
- **Для reel:** это лучший случай. Один URL + ключ даёт агрегированный поиск с ID. Нюанс: если индексатор не поддерживает ID-поиск, Jackett для него вернёт пусто или подставит текстовый запрос, это зависит от определения [не уверен]. Поэтому reel делает два запроса: по ID и текстовый fallback (см. §4.4).
- **Легальная проверка:** в Jackett есть определения `internetarchive.yml` и `linuxtracker.yml` [проверено]. Значит, цепочку «Jackett → reel» можно тестировать вживую только на легальных раздачах.

### 1.3 Prowlarr и его связь с Sonarr/Radarr

- [Prowlarr/Prowlarr](https://github.com/Prowlarr/Prowlarr): GPL‑3.0, около 7.6k звёзд [проверено]. Определения индексаторов лежат отдельно, в [Prowlarr/Indexers](https://github.com/Prowlarr/Indexers); там тоже есть `internetarchive.yml` и `linuxtracker.yml` [проверено].
- Роль в стеке *arr: Prowlarr — менеджер индексаторов. Он «синхронизирует» их в Sonarr (сериалы) и Radarr (фильмы): для каждого индексатора прописывает в них Torznab-URL вида `{prowlarr}/{id}/api`. Sonarr и Radarr — это автоматизация «скачать в библиотеку», не плеер. reel по отношению к Prowlarr занимает то же место, что Sonarr и Radarr, только с воспроизведением вместо скачивания.
- **API** [проверено, `src/Prowlarr.Api.V1/openapi.json`]:
  - `GET /{id}/api` и `GET /api/v1/indexer/{id}/newznab`: Torznab/Newznab одного индексатора, параметры `t, q, cat, imdbid, tmdbid, tvdbid, tvmazeid, traktid, doubanid, rid, season, ep, year, genre, limit, offset, minsize, maxsize, minage, maxage, extended`.
  - `GET /api/v1/search?query=&type=&indexerIds=&categories=&limit=&offset=`: **агрегированный** поиск, ответ JSON-массив `ReleaseResource`: `guid, title, size, files, grabs, indexerId, indexer, imdbId, tmdbId, tvdbId, tvMazeId, publishDate, downloadUrl, magnetUrl, infoHash, seeders, leechers, protocol, categories, infoUrl, fileName`.
  - ID-поиск через `/api/v1/search` задаётся токенами в `query`: `{imdbid:tt…}`, `{tmdbid:…}`, `{tvdbid:…}`, `{season:…}`, `{episode:…}` при `type=movie` или `tvsearch` [проверено, regex в `src/NzbDrone.Core/IndexerSearch/NewznabRequest.cs`].
  - `GET /api/v1/indexer`: список индексаторов (для здоровья и показа «сколько источников»).
- **Вывод:** у Prowlarr нет единого Torznab-URL «по всем», поэтому ему нужен **отдельный тонкий адаптер** на `/api/v1/search`. Альтернатива — пользователь добавляет каждый `{id}/api` как Generic Torznab, но это неудобно.

### 1.4 BitMagnet

- [bitmagnet-io/bitmagnet](https://github.com/bitmagnet-io/bitmagnet): MIT, Go, около 4.5k звёзд, последний push 08.2026 [проверено]. Это «self-hosted BitTorrent indexer, DHT crawler, content classifier and torrent search engine». Сайт прямо говорит: «currently in alpha»; аутентификации и API-ключей пока нет [проверено, bitmagnet.io].
- Работает так: краулер обходит DHT (BEP 5 + BEP 51), по каждому найденному infohash тянет метаданные у пиров (BEP 9), классифицирует (тип, разрешение, язык) и обогащает TMDB. Отдаёт Torznab на `/torznab` («Generic Torznab» в Prowlarr, «just click Test») [проверено, guides/servarr-integration].
- Требует Postgres, крутится постоянно, база растёт со временем. Требования к RAM и диску в документации не указаны [проверено: не нашёл]. На TV и телефоне это нереально.
- Юридически BitMagnet индексирует **всё подряд** из DHT, и индекс получается у самого пользователя. Для reel это просто ещё один Torznab-URL, особой поддержки не нужно. Не стоит выделять BitMagnet в UI как «рекомендуемый способ найти фильмы»: это та же витрина, только другими словами.

### 1.5 NZBHydra2

- [theotherp/nzbhydra2](https://github.com/theotherp/nzbhydra2): GPL‑3.0 [проверено]. Метапоиск для **Usenet** (Newznab-индексаторы), умеет подключать и Torznab-источники, например Jackett, и отдаёт Newznab/Torznab API [вторично, README]. reel — торрент-плеер, Usenet в планах нет, поэтому Newznab нужен только как родитель формата Torznab. Поддержку «бесплатно» даёт общий XML-парсер, но тип `nzb` reel должен отбрасывать.

### 1.6 Модель аддонов Stremio и self-hosted «Torrentio-подобные» сервисы

**Протокол** [проверено, [protocol.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md), [stream.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md), [defineStreamHandler.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineStreamHandler.md)]:

- Аддон — это HTTP-сервис. `GET {base}/manifest.json` → `{id, version, name, types, resources, idPrefixes, catalogs, behaviorHints}`.
- Поток: `GET {base}/stream/{type}/{id}.json`, где `type` — `movie` или `series`, `id` — IMDb-ID фильма (`tt…`) или **`tt…:{season}:{episode}`** для эпизода. Пример из документации: `tt0898266:9:17`. Дополнительные параметры передаются как `/{resource}/{type}/{id}/{extra}.json`.
- Ответ `{ streams: [Stream] }`, у Stream один из источников: `url`, `ytId`, **`infoHash` + `fileIdx`**, `externalUrl` (а также `nzbUrl` и архивы). Поля отображения: `name` (обычно качество), `description` (заменяет устаревший `title`), `subtitles`, `sources` (`tracker:udp://…`, `dht:<id>`). `behaviorHints`: `bingeGroup`, `notWebReady`, `countryWhitelist`, `proxyHeaders`, `videoHash`, `videoSize`, `filename`.
- `fileIdx` — индекс видеофайла внутри торрента. Если его нет, «the largest file in the torrent will be selected».
- Все маршруты отдают CORS `*`. Кэш задаётся через `Cache-Control` (`cacheMaxAge`, `staleRevalidate`).
- Конфигурация аддона обычно зашита в путь URL (base64 или JSON-сегмент перед `/manifest.json`). Внутри может оказаться API-ключ пользователя от Jackett или debrid, поэтому URL аддона — секрет.

**Self-hosted реализации** (все — Stremio-аддоны, которые сами опрашивают Torznab-источники пользователя):

| Проект | Лицензия | Состояние | Что делает |
|---|---|---|---|
| [g0ldyy/comet](https://github.com/g0ldyy/comet) | GPL‑3.0 | активен (11.2026) [проверено] | Python, Docker, SQLite/Postgres; скрейперы: Jackett, Prowlarr, BitMagnet, Zilean и др.; заявлен режим «Direct Torrent» без debrid [вторично] |
| [mhdzumair/MediaFusion](https://github.com/mhdzumair/MediaFusion) | MIT | активен (10.2026) [проверено] | Docker/K8s; источники Prowlarr, Jackett, RSS и др.; P2P и debrid; Stremio и Kodi; сам отдаёт Torznab для *arr [вторично]. GitHub показывает основной язык Rust, README про стек молчит [не уверен] |
| [Viren070/AIOStreams](https://github.com/Viren070/AIOStreams) | AGPL‑3.0 | активен [проверено] | агрегатор **других аддонов**: склеивает, фильтрует, сортирует |
| [arvida42/jackettio](https://github.com/arvida42/jackettio) | Apache‑2.0 | последний push 11.2024 [проверено] | Jackett + **обязательный** debrid [вторично] |
| [knightcrawler-stremio/knightcrawler](https://github.com/knightcrawler-stremio/knightcrawler) | Apache‑2.0 | последний push 11.2024 [проверено] | self-hosted аналог Torrentio со своими скрейперами |
| [MunifTanjim/stremthru](https://github.com/MunifTanjim/stremthru) | MIT | активен [проверено] | «companion» к Stremio, в основном debrid-прокси |

Torrentio — сторонний **сервис**; его скрейпер открыт (Apache‑2.0, Rust) [проверено]. reel описывает и реализует только **протокол**, сервис не упоминает ни в UI, ни в документации.

**Для reel:** клиент протокола (только `manifest` + `stream`) прост. Он даёт уже ранжированные потоки с `infoHash`/`fileIdx` по нашему IMDb-ID (для эпизода `tt…:S:E`). Нужен IMDb-ID из метаданных: у TMDB он есть в `external_ids`. Минусы: качество и формат `name`/`description` у всех аддонов разные, сидеры и размер часто лежат в свободном тексте, а не в полях. Многие аддоны заточены под debrid (`url` вместо `infoHash`). reel принимает **только `infoHash`** (и, возможно, легальные `url`) и показывает понятную ошибку на остальное.

### 1.7 DHT-поиск как «агрегатор без сервера»

- **BEP 5** (DHT): `get_peers(infohash)` находит пиров **по уже известному хэшу**. Поиска по словам нет.
- **BEP 9** (`ut_metadata`): по infohash скачивает словарь info у пиров, то есть имена файлов и размеры.
- **BEP 51** (`sample_infohashes`) [проверено, [bep_0051](https://www.bittorrent.org/beps/bep_0051.html)]: узел отдаёт случайную выборку хранимых хэшей (`samples`), общее число (`num`) и `interval` до 6 ч, раньше которого нельзя спрашивать снова. Цель BEP прямо названа: «specialized indexers», и он «cannot be directly used to search for specific torrents».
- **Практичность для reel:** локальный «поиск по DHT» означает часы и дни обхода, хранение миллионов записей, BEP 9 к тысячам пиров и постоянный трафик. На телевизоре это невозможно, на телефоне вредно. И это снова был бы индекс, который строит само приложение (позиция Ziggo/TPB, C‑610/15). **Вывод:** DHT нужен reel только для того, для чего он нужен любому клиенту (найти пиров по известному хэшу, это делает librqbit). Поиск через DHT — задача BitMagnet у пользователя, а reel лишь получает его Torznab.

---

## 2. Протоколы и API подробнее

### 2.1 Torznab

Спецификация: [Torznab 1.3 draft](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html) [проверено]; Torznab — расширение [Newznab API](https://newznab.readthedocs.io/en/latest/misc/api/) для торрентов. Транспорт: `GET {base}?t=…&apikey=…`, ответ RSS 2.0 + `torznab:attr` (namespace `http://torznab.com/schemas/2015/feed`).

- **`t=caps`** (ключ часто не нужен): `<limits max default>`, `<searching>` с элементами `search`, `tv-search`, `movie-search` (`available="yes"`, `supportedParams="q,imdbid,tmdbid,season,ep"`), `<categories>` с `<subcat>`, `<tags>`.
- **Функции:** `t=search` (`q`), `t=tvsearch` (`q, season, ep, imdbid, tvdbid, tmdbid, tvmazeid, rid`), `t=movie` (`q, imdbid, tmdbid`). В тексте черновика 1.3 `tmdbid` прямо не описан, но Jackett и Prowlarr его поддерживают; смотреть надо на `supportedParams` в caps [проверено: в спеке нет, в Jackett README и Prowlarr openapi есть].
- **Общие параметры:** `cat` (через запятую), `limit`, `offset`, `extended=1` (все атрибуты) или `attrs=…`, `tag`.
- **Категории:** `2000` Movies (`2010` Foreign, `2030` SD, `2040` HD, `2045` UHD, `2050` BluRay, `2060` 3D), `5000` TV (`5030` SD, `5040` HD, `5045` UHD, `5070` Anime). Подкатегории фильмов кроме 2010 и ТВ кроме 5040/5070 взяты из Newznab-конвенции [вторично]. Трекерные кастомные категории имеют ID от 100000; их надо сводить к родительской через caps.
- **Атрибуты `torznab:attr`:** обязательные `size`, `category`; торрентные `seeders`, `leechers`, `peers`, **`infohash`** (hex lowercase), **`magneturl`**, `downloadvolumefactor`/`uploadvolumefactor` (freeleech), `minimumratio`, `minimumseedtime`; общие `files`, `grabs`, `poster`, `year`; ТВ: `season`, `episode`, `tvdbid`, `tvmazeid`; кино: `imdb`, `imdbtitle`, `imdbyear`. Повторяющиеся атрибуты — это список. Плюс стандартные RSS-поля: `title`, `guid`, `link` (часто прокси-ссылка на .torrent у самого агрегатора), `enclosure` (url, length, type `application/x-bittorrent`), `pubDate`, `comments`.
- **Ошибки:** `<error code="…" description="…"/>`. В спеке описан `201 Incorrect parameter`. Newznab-коды `100–102` (ключ), `200–203` (параметры), `300` (нет функции), `900` (прочее) встречаются на практике [вторично].
- **Гарантий нет:** `infohash` и `magneturl` есть не всегда. Часть результатов приходит только с `link` на .torrent, и тогда хэш reel вычисляет сам, скачав .torrent через агрегатор (см. §4.5).

### 2.2 REST Jackett и Prowlarr — что брать

- **Jackett:** только Torznab (`/api/v2.0/indexers/{all|filter|id}/results/torznab/api`) и `t=indexers` для списка. JSON-эндпоинт `/results` существует (его использует Lampa), но в README не описан, поэтому reel на него не опирается [проверено: Lampa использует, README не описывает].
- **Prowlarr:** `/api/v1/search` (JSON, агрегатно, ID-токены в `query`), `/api/v1/indexer` (список и состояние), `/api/v1/system/status` (для проверки ключа и версии). Заголовок `X-Api-Key` [проверено, openapi].

### 2.3 Готовые библиотеки на Rust

- `torznab` 0.7.2 (MIT): последний релиз 12.2021, проект заброшен [проверено, crates.io]. Лучше свой тонкий клиент: `reqwest` + `quick-xml`/`serde`, около 300–500 строк.
- Парсеры имён релизов — см. §4.6.

---

## 3. «Один агрегатор»: сравнение кандидатов на единую точку интеграции

| Критерий | Torznab (Jackett / Prowlarr per-indexer / BitMagnet / NZBHydra2) | Prowlarr `/api/v1/search` | BitMagnet | Stremio-аддон (`stream`) |
|---|---|---|---|---|
| Кто ещё говорит этим языком | Jackett, Prowlarr, BitMagnet, NZBHydra2, TorrServer, MediaFusion, сотни *arr-интеграций | только Prowlarr | Torznab + GraphQL | Comet, MediaFusion, AIOStreams, KnightCrawler и все аддоны Stremio |
| ID-поиск | `imdbid/tmdbid/tvdbid + season/ep`, если есть в caps | да, токенами | по TMDB-классификации [не уверен в полноте Torznab-параметров] | только IMDb (`tt…:S:E`) |
| Структурированные поля | seeders, peers, size, infohash, magnet — в атрибутах | да, JSON | да | нет: свободный текст в `name`/`description` |
| Привязка к файлу эпизода | нет, делает reel | нет | нет | да, `fileIdx` |
| Сложность клиента | средняя (XML, caps, категории) | низкая | — | низкая |
| Нужен сервер у пользователя | да | да | да, мощный | да, или чужой удалённый аддон |
| Стандарт и стабильность | де-факто стандарт 10+ лет | стабильный v1 | alpha | стабильный, но аддоны разнородны |

**Вывод.** «Одного агрегатора» как сервиса нет, и reel не должен его назначать. Единая **точка интеграции** — это **протокол Torznab**: его отдают все три программы, которые реально сводят индексаторы (Jackett, Prowlarr, BitMagnet). Рядом нужны:

1. **Primary:** Generic Torznab + пресеты формы URL для Jackett (`/api/v2.0/indexers/all/results/torznab/api`) и BitMagnet (`/torznab`). Пресеты задают **путь**, а не адрес.
2. **Primary-2:** нативный Prowlarr (`/api/v1/search`), потому что агрегат Prowlarr доступен только так.
3. **Optional:** клиент Stremio-протокола (только `stream`, только `infoHash`), за тем же экраном согласия.
4. **Не делать:** qBittorrent-плагины (нужен qBittorrent + Python, слабые поля), TorrServer-поиск (он лишь прокси Torznab либо база одного трекера), DHT-поиск на устройстве, собственный движок определений трекеров.

---

## 4. Архитектура в reel

### 4.1 Где живёт поиск

```
UI (NSH/TSX) ──IPC/FFI──► reel-core (Rust)
                            ├─ metadata  (TMDB/IMDb; docs/research-metadata.md)
                            ├─ sources   ← НОВОЕ: реестр источников, адаптеры, health
                            │    ├─ TorznabAdapter   (Jackett, BitMagnet, generic)
                            │    ├─ ProwlarrAdapter  (/api/v1/search)
                            │    ├─ StremioAdapter   (manifest + stream)
                            │    └─ ArchiveOrgAdapter (встроенный легальный)
                            ├─ search    (fan-out, merge, dedup, rank, cache)
                            ├─ resolver  (magnet/.torrent → infohash, файлы, fileIdx)
                            └─ engine    (librqbit, Apache-2.0 [проверено, crates.io 9.1.0])
```

- Вся сеть и парсинг живут **в Rust-ядре**, а не в TSX. Одна реализация на Tizen, macOS, Android и iOS; нет CORS-проблем на Tizen (webview к LAN по HTTP); API-ключи не попадают в JS-слой и логи UI.
- Адаптер — это trait. Исполняемого кода плагинов нет: источник — это **данные** (URL, ключ, тип). Это совпадает с выводом прошлого отчёта (iOS 2.5.2, Tizen).

```rust
#[async_trait]
trait SourceAdapter: Send + Sync {
    async fn probe(&self, cfg: &SourceConfig) -> Result<SourceCaps, SourceError>;   // «Проверить»
    async fn search(&self, cfg: &SourceConfig, q: &SearchQuery, caps: &SourceCaps)
        -> Result<Vec<RawRelease>, SourceError>;
}
```

### 4.2 Как пользователь добавляет источник

1. Настройки → Источники. **Пусто по умолчанию**, текст: «Источники не настроены. reel может воспроизводить ваши файлы, ссылки magnet и .torrent, а также встроенную коллекцию открытых фильмов».
2. «Добавить источник» → при первом разе **экран согласия** (текст в прошлом отчёте, §5.7).
3. Выбор **типа**: «Torznab (Jackett, BitMagnet и др.)», «Prowlarr», «Stremio add-on». Это названия **ПО и протоколов**, не индексаторов. Никаких списков «популярных источников» и никаких ссылок «где найти».
4. Поля: URL, API-ключ, имя (по умолчанию из caps `<server title>` или manifest `name`). Плейсхолдер: `http://192.168.1.10:9117` или `https://indexer.example`.
5. **«Проверить подключение»:**
   - Torznab: `t=caps` → режимы и `supportedParams`, категории, limits; затем контрольный `t=search&q=test&limit=1` с ключом (caps часто проходит без ключа, поэтому сам ключ проверяет только поиск).
   - Prowlarr: `/api/v1/system/status` + `/api/v1/indexer` → «N индексаторов включено».
   - Stremio: `manifest.json` → в `resources` есть `stream`, в `types` есть `movie`/`series`, `idPrefixes` содержит `tt`.
   - Итог показывается человеческими словами: «Поиск фильмов по IMDb: да; сериалов по сезону/эпизоду: да; только текстовый поиск: …».
6. **Ввод на TV.** Набирать URL и ключ пультом мучительно. Ядро reel на TV поднимает локальную страницу `http://<tv-ip>:<port>/setup` с одноразовым PIN и показывает QR. Пользователь вставляет URL и ключ с телефона. Альтернатива: reel на телефоне передаёт конфиг источника на TV по локальной сети после спаривания по QR. **Никакой синхронизации через облако проекта.**
7. Ключи хранятся в защищённом хранилище платформы (Keychain, Android Keystore; на Tizen — зашифрованный файл приложения). В логах и отчётах об ошибках URL проходит редакцию (`apikey=***`, путь Stremio-конфига скрыт).

### 4.3 Модель данных

```rust
// ===== Источники =====
pub struct SourceId(pub Uuid);

pub enum SourceKind { Torznab, Prowlarr, StremioAddon, ArchiveOrg /* встроенный */ }

pub struct SourceConfig {
    pub id: SourceId,
    pub kind: SourceKind,
    pub name: String,
    pub base_url: Url,            // ввёл пользователь; для ArchiveOrg — константа в коде
    pub api_key: Option<SecretRef>, // ссылка в keychain, не сам ключ
    pub enabled: bool,
    pub priority: i8,              // пользовательский вес при ранжировании
    pub timeout: Duration,         // по умолчанию 12 s
    pub categories: Option<Vec<u32>>, // переопределение cat
    pub added_at: SystemTime,
}

pub struct SourceCaps {
    pub movie_search: Option<Vec<IdParam>>, // Imdb, Tmdb
    pub tv_search: Option<Vec<IdParam>>,    // Imdb, Tvdb, Tmdb, Season, Ep
    pub text_search: bool,
    pub max_limit: Option<u32>,
    pub categories: Vec<Category>,          // id, name, parent
    pub fetched_at: SystemTime,
}
pub enum IdParam { Imdb, Tmdb, Tvdb, TvMaze, Season, Episode, Year }

pub struct SourceHealth {
    pub last_ok: Option<SystemTime>,
    pub last_error: Option<(SystemTime, SourceErrorKind)>, // Auth, Timeout, Http(u16), Parse, Network
    pub p50_latency: Option<Duration>,
    pub consecutive_failures: u32,           // для circuit breaker
}

// ===== Запрос =====
pub struct SearchQuery {
    pub media: MediaRef,
    pub titles: Vec<String>,   // оригинальное + локализованные названия для текстового fallback
    pub year: Option<u16>,
    pub want_packs: bool,      // для эпизода искать и сезонные паки
}

pub enum MediaRef {            // ссылка на модель метаданных (docs/research-metadata.md)
    Movie   { title_id: TitleId, imdb: Option<String>, tmdb: Option<u32> },
    Episode { show_id: TitleId, imdb_show: Option<String>, tmdb_show: Option<u32>,
              tvdb_show: Option<u32>, season: u16, episode: u16,
              absolute: Option<u32> /* аниме */ },
    Season  { show_id: TitleId, imdb_show: Option<String>, tmdb_show: Option<u32>, season: u16 },
}

// ===== Результат =====
pub struct InfoHash(pub [u8; 20]); // v1; BEP 52 v2 (32 байта) — отдельным вариантом позже

pub struct Release {
    pub infohash: Option<InfoHash>,   // None, пока не разрешён из .torrent
    pub magnet: Option<String>,
    pub torrent_url: Option<Url>,     // ссылка на .torrent через агрегатор (с ключом — не логировать)
    pub title: String,                // сырое имя релиза
    pub size: Option<u64>,
    pub seeders: Option<u32>,
    pub peers: Option<u32>,
    pub published: Option<SystemTime>,
    pub file_count: Option<u32>,
    pub quality: Quality,             // разобрано из имени
    pub languages: Vec<LangTag>,      // аудио/дубляж, если распознаны
    pub subtitles: Vec<LangTag>,
    pub provenance: Vec<Provenance>,  // все источники, вернувшие этот infohash
    pub ids_from_source: ExternalIds, // imdb/tvdb из torznab:attr, если были
    pub kind: ReleaseKind,            // Single, SeasonPack, MultiSeason, Complete
    pub files: Option<Vec<TorrentFile>>, // после резолва метаданных
}

pub struct Provenance { pub source: SourceId, pub indexer: Option<String>, pub guid: String,
                        pub category: Vec<u32>, pub file_idx_hint: Option<u32> /* Stremio */ }

pub struct Quality {
    pub resolution: Option<Resolution>,    // 480p..2160p
    pub source: Option<MediaSource>,       // WEB-DL, WEBRip, BluRay, Remux, HDTV, Cam...
    pub video_codec: Option<VideoCodec>,   // H264, HEVC, AV1
    pub hdr: Vec<Hdr>,                     // HDR10, HDR10Plus, DolbyVision(profile?), HLG
    pub audio: Vec<AudioCodec>,            // AAC, AC3, EAC3, DTS, DTS-HD, TrueHD, Atmos
    pub channels: Option<String>,          // "5.1"
    pub bit_depth: Option<u8>,
    pub flags: Vec<String>,                // REPACK, PROPER, 3D, Hardsub...
}

pub struct TorrentFile { pub idx: u32, pub path: String, pub size: u64,
                         pub parsed: Option<FileEpisode> }
pub struct FileEpisode { pub season: Option<u16>, pub episodes: Vec<u16>, pub absolute: Option<u32> }

// ===== Связь с метаданными =====
pub struct ReleaseMatch {
    pub infohash: InfoHash,
    pub media: MediaRef,
    pub file_idx: Option<u32>,   // какой файл играть для этого эпизода/фильма
    pub confidence: f32,         // 1.0: ID от источника + совпал SxxEyy; ниже — по тексту
    pub method: MatchMethod,     // SourceIds, ParsedName, FileList, UserPicked
}
```

`Title`/`Episode` в модели метаданных про торренты не знают. Связь хранится отдельно, в `ReleaseMatch` (ключ `MediaRef` + `infohash`). Это позволяет помнить выбор пользователя («для S02E03 играть файл 7 из этого торрента») и стирать торрентные данные целиком, не трогая библиотеку.

### 4.4 Как формируется запрос

Для каждого включённого источника план строится из его caps:

| Цель | ID-поиск (если caps позволяет) | Текстовый fallback |
|---|---|---|
| Фильм | `t=movie&imdbid=tt…` (или `tmdbid=`), `cat=2000` | `t=search&q="{Title} {Year}"`, `cat=2000` |
| Эпизод | `t=tvsearch&imdbid=tt…&season=S&ep=E`, `cat=5000` (+ `tvdbid` или `tmdbid`, что есть в caps) | `q="{Title} S01E02"` |
| Паки | тот же `tvsearch` с `season=S` без `ep` | `q="{Title} S01"` / `"{Title} Season 1"` |
| Prowlarr | `query={imdbid:tt…}{season:1}{episode:2}&type=tvsearch&categories=5000` | `type=search&query=…` |
| Stremio | `/stream/series/tt…:1:2.json` или `/stream/movie/tt….json` | — |

- Если ID-поиск вернул ноль, тут же уходит текстовый. Текстовые результаты помечаются меньшим `confidence`, а их имя проходит проверку парсером: совпали название (нормализованное), год и SxxEyy.
- Для локализованных трекеров нужны альтернативные названия из метаданных (`titles`). Их перебор ограничен: не больше двух текстовых запросов на источник.
- `extended=1`, чтобы получить `infohash`, `magneturl`, `files`, `imdb`.

### 4.5 Слияние, дедупликация, разрешение хэша

1. Fan-out: `tokio::JoinSet`, по одному запросу на источник одновременно (Jackett `all` сам параллелит внутри), общий дедлайн 15–20 с, у каждого источника свой `timeout`. **Результаты стримятся в UI по мере прихода**: первый ответ виден через 1–2 с.
2. Нормализация infohash: из `torznab:attr infohash`, из `xt=urn:btih:` в magnet (hex 40 или base32 32 → hex lowercase), из Stremio `infoHash`.
3. **Дедуп по infohash.** `Provenance` склеиваются, seeders и peers берутся максимальные (они от разных трекеров, суммировать нельзя), title — самый информативный (длиннее, больше распознанных полей).
4. Результаты без хэша (только `link` на .torrent) лениво резолвятся для top-N (около 10) после ранжирования: reel скачивает .torrent через агрегатор, считает infohash и получает список файлов сразу. Затем снова дедуп.
5. Fallback-ключ для оставшихся без хэша: `(normalized_title, size)`. Это не идентичность, а только подсказка; такие пары не склеиваются, а помечаются «похоже на дубликат».

### 4.6 Ранжирование и разбор имён релизов

**Парсеры имён:**

| Библиотека | Язык | Лицензия | Статус |
|---|---|---|---|
| [guessit](https://github.com/guessit-io/guessit) | Python | LGPL‑3.0 | эталон, активен [проверено] |
| PTN (parse-torrent-name, исходный репо удалён) → [platelminto/parse-torrent-title](https://github.com/platelminto/parse-torrent-title) | Python | MIT | активный форк [проверено] |
| [TheBeastLT/parse-torrent-title](https://github.com/TheBeastLT/parse-torrent-title) | **Rust** (раньше JS), crate `parse-torrent-title` 2.0.10 | MIT | релиз 11.2026, используется в стеке Torrentio-скрейпера [проверено] |
| [clement-escolano/parse-torrent-title](https://github.com/clement-escolano/parse-torrent-title) | JS | MIT | поддерживается [проверено] |
| [dreulavelle/PTT](https://github.com/dreulavelle/PTT) + [rank-torrent-name](https://github.com/dreulavelle/rank-torrent-name) | Python | MIT | порт парсера + готовый ранжировщик с профилями [проверено] |
| crate [`hunch`](https://crates.io/crates/hunch) | Rust | MIT | 2.0.4, 10.2026, «inspired by guessit» [проверено] |
| crate [`torrent-name-parser`](https://crates.io/crates/torrent-name-parser) | Rust | MIT | 0.12.1, 2023, застой [проверено] |

Рекомендация: взять crate `parse-torrent-title` (MIT, Rust, активный, покрывает аниме, языки, паки) и держать **свои тест-фикстуры только на легальных именах** (Blender, Internet Archive, Linux ISO и синтетические строки вида `Example.Show.S01E02.1080p.WEB-DL.x265-GROUP`). Если его покрытия не хватит, сравнить с `hunch`.

**Формула ранжирования** (веса настраиваются, есть профиль «по умолчанию для устройства»):

- **Совместимость с устройством — жёсткий фильтр или сильный штраф.** Возможности декодера платформа сообщает при старте:
  - Samsung Tizen: HEVC и HDR10/HDR10+ есть, **Dolby Vision нет**, поддержки **DTS** в ТВ Samsung с 2018 модельного года нет [вторично; проверить на конкретной модели]. Значит, DV-only (профиль 5) и DTS-only релизы опускаются вниз или помечаются «нужен перекод звука», если reel будет уметь транскод аудио.
  - AV1 только на новых SoC.
  - Apple: DV и HEVC есть, DTS нет без программного декодера.
- **Живость:** `log2(1 + seeders)` с насыщением. При 0 сидеров — сильный штраф, но релиз не скрывается.
- **Качество:** предпочтение разрешения не выше экрана (4K на 1080p-экране не даёт плюса). Remux > BluRay > WEB-DL > WEBRip > HDTV. Низкокачественные экранные записи (Cam/TS/TC) по умолчанию сильно штрафуются.
- **Размер против канала:** оценка битрейта `size / runtime` (runtime из метаданных) против измеренной скорости. Для стриминга 80 ГБ Remux при 20 Мбит/с — плохой выбор.
- **Язык:** совпадение аудиодорожек и субтитров с языками пользователя (теги `MULTI`, коды языков и т.п. в имени).
- **Точность сопоставления:** `confidence` из §4.4; одиночный эпизод выше пака при равных прочих (быстрее старт), пак выше при «смотреть сезон».
- **Источник:** `priority` пользователя, freeleech/ratio-атрибуты для приватных трекеров (`downloadvolumefactor`).

UI: по умолчанию «лучший вариант» плюс раскрываемый список с чипами (2160p · HEVC · HDR10 · 5.1 · 12.4 GB · 230↑). Не стоит делать автозапуск без показа, что именно и откуда выбрано: прозрачность полезна и пользователю, и позиции проекта.

### 4.7 Многофайловый торрент → эпизод (fileIdx)

1. Если источник дал `fileIdx` (Stremio), он используется, но проверяется по имени файла после получения метаданных.
2. Иначе librqbit добавляет торрент **в режиме только метаданных** (в API librqbit есть добавление с `list_only`/выбором `only_files` [вторично, docs.rs; проверить точное API в 9.x]) и получает список файлов.
3. Каждый видеофайл (`mkv/mp4/avi/ts/m2ts`, кроме `sample`, `trailer`, `extras`) проходит через тот же парсер: `S01E02`, `1x02`, `S01E02E03` (мультиэпизод), `Episode 2`, абсолютная нумерация для аниме (через `absolute` из метаданных), папки `Season 1/`.
4. Сопоставление `(season, episode)` → `idx`. При неоднозначности (несколько кандидатов, extended cut) выбирается больший файл или показывается выбор пользователю. Выбор запоминается в `ReleaseMatch(method=UserPicked)`.
5. Если ничего не распознано и это фильм — берётся самый большой видеофайл (как в Stremio).
6. Субтитры: `.srt/.ass` рядом с выбранным файлом сопоставляются по базовому имени.
7. Карта `infohash → [(S,E) → idx]` кэшируется навсегда: метаданные торрента неизменны. Сезонный пак после первого эпизода сразу знает все остальные; «следующая серия» берётся из того же торрента (аналог `bingeGroup`).

### 4.8 Кэш, таймауты, здоровье

- **caps:** 24 ч, плюс принудительное обновление по «Проверить».
- **Результаты поиска:** ключ `(source_id, normalized query plan)`, TTL 30 мин для новых (выход меньше 30 дней назад по метаданным) и 6 ч для остальных; stale-while-revalidate (показать кэш, обновить в фоне). Отрицательный кэш (0 результатов) — 15 мин.
- **Метаданные торрента и fileIdx:** без TTL, LRU по размеру.
- **Хранение:** только локально, SQLite в ядре. **Никакой отправки запросов или результатов на серверы проекта**: общий кэш у разработчика превратил бы проект в индекс.
- **Таймауты:** connect 4 с, ответ 12 с на источник (Jackett `all` со множеством индексаторов бывает медленным; таймаут настраивается).
- **Ретраи:** 1 повтор на сетевую ошибку; 401/403 не ретраить, а пометить «ключ неверен»; 429 — экспоненциальный backoff.
- **Circuit breaker:** после 3 ошибок подряд источник пропускается 5 минут; в настройках он помечается жёлтым или красным с последней ошибкой.
- **Health check:** лёгкий `t=caps` (или `system/status`) при старте приложения и раз в час, пока приложение активно. Без фоновых запросов, когда reel закрыт.
- Ответы ограничены по размеру (например, 5 МБ XML) и потоково парсятся. На Tizen память ограничена.

### 4.9 Ограничения TV и сценарии без агрегатора

- **Tizen:** всё работает внутри приложения: Rust-ядро, librqbit, адаптеры. Внешние процессы невозможны. Доступ к LAN по HTTP есть. Автообнаружения Jackett и Prowlarr нет: они не анонсируют себя по mDNS [не уверен]. Значит, адрес вводится вручную, через страницу `/setup` или QR.
- **Пользователь с NAS или ПК:** Prowlarr или Jackett там уже стоят (типичный *arr-стек) → он вводит адрес в reel → всё работает. Это основной сценарий для поиска.
- **macOS:** Prowlarr или Jackett можно поставить локально. reel на Mac может служить и **хабом для TV**: TV играет через HTTP-API движка на Mac (прошлый отчёт, §5.1 п. 5), поиск выполняет reel на Mac с его источниками.
- **Семья только с телевизором:**
  1. reel работает как плеер: magnet или .torrent, отправленный с телефона (reel-mobile или любой браузер → страница `/setup` → «отправить ссылку на TV»), локальные файлы и USB, сетевые папки, Jellyfin.
  2. Встроенный **Internet Archive** (легальный, без настройки) — чтобы приложение не было пустым.
  3. Stremio-совместимый аддон по URL, который **пользователь сам ввёл**. reel не знает, не хранит, не предлагает и не помогает искать такие адреса.
  4. Для полноценного поиска нужен домашний агрегатор. Документация описывает это нейтрально: «reel connects to Torznab-compatible indexer managers you run yourself (for example Jackett or Prowlarr) and to the Internet Archive».

### 4.10 Встроенный легальный источник: Internet Archive

- Реализовать как `ArchiveOrgAdapter`, тот же trait, что и у остальных: поиск через официальный Advanced Search/Scrape API archive.org по коллекциям (фильмы в общественном достоянии, Prelinger, Blender Open Movies), торрент каждого item — `https://archive.org/download/{id}/{id}_archive.torrent`.
- Это единственный адрес контента, допустимый в коде: он легальный и не пиратский. Тот же адаптер служит интеграционным тестом всей цепочки (поиск → ранжирование → резолв → fileIdx → воспроизведение).
- Для CI записываются фикстуры: XML caps и search от Jackett с индексатором Internet Archive (в Jackett и Prowlarr есть определение `internetarchive`) и JSON `/api/v1/search` от Prowlarr. В фикстурах только легальные раздачи.

---

## 5. Право и гигиена репозитория при интеграции индексаторов

Повторяю коротко то, что следует из прошлого отчёта (Filmspeler C‑527/15, GS Media C‑160/15, Ziggo C‑610/15, Grokster), применительно именно к поиску:

1. **По умолчанию пусто.** Источников нет, поиск раздач не работает и не показывается, пока пользователь не добавил источник. Кнопка «Смотреть» на карточке без источника ведёт к легальным вариантам (Internet Archive, если там есть; трейлер; «где смотреть» по данным метаданных) и к «Добавить свой источник». Молча искать она не должна.
2. **Никаких адресов.** В коде, тестах, фикстурах, примерах конфигов, документации, скриншотах и истории git нет доменов трекеров и публичных инстансов Jackett/Prowlarr/аддонов. Плейсхолдеры: `https://indexer.example`, `http://192.168.1.10:9117`. Нужна CI-проверка: деннилист доменов в отдельном приватном месте или эвристика на `magnet:` и `btih` в фикстурах, кроме разрешённых легальных хэшей. Lampa с миграцией адреса публичного парсера — пример того, как делать нельзя.
3. **Типы источников, а не источники.** UI и документация называют протоколы и ПО (Torznab, Prowlarr, Jackett, BitMagnet, Stremio add-on protocol). Нет каталога, «популярных», «рекомендованных», импорта списков по ссылке из проекта, синхронизации через облако проекта.
4. **Нет движка определений трекеров** (Cardigann-YAML или скриптов) в reel. Даже без определений он неизбежно породит «репозиторий определений для reel», и проект будет выглядеть как Jackett внутри плеера. Пусть это остаётся в отдельном ПО, которое пользователь запускает сам.
5. **Нет центрального кэша и телеметрии запросов.** Если проект хранит «что ищут» и «какие хэши у какого фильма», он сам становится индексом (Ziggo) и «знает» о нарушениях (GS Media).
6. **Debrid вне области проекта.** Это платные сервисы, кэширующие чужой контент; интеграция с ними — коммерческая связка с вероятным нарушением и дополнительный риск inducement. Stremio-адаптер принимает `infoHash`, а `url`-потоки — только если это не требует debrid-ключей в reel [моя рекомендация, не правовая оценка].
7. **Экран согласия** при первом добавлении любого источника (текст в прошлом отчёте, §5.7) и отдельная строка про раздачу при торрент-воспроизведении (Mircom C‑597/19): лимит отдачи и «не раздавать после просмотра» как настройки.
8. **Формулировки в документации** (`docs/sources.md`):
   > reel can search sources that you configure yourself: Torznab-compatible indexer managers you run (such as Jackett, Prowlarr or BitMagnet), Prowlarr's search API, and services that implement the Stremio add-on protocol. reel ships with no third-party sources and does not recommend any. The built-in Internet Archive source covers public-domain and openly licensed films. You are responsible for the sources you add and for complying with the law in your country.
   
   Без «найди любой фильм», «бесплатно», «новинки», без скриншотов с коммерческими постерами в результатах поиска: в моках только Blender, Internet Archive и синтетические имена релизов.
9. **Issue и поддержка.** Вопросы «какой индексатор добавить», «не находит фильм X» закрываются шаблоном: проект помогает только с протоколом и ошибками подключения, на примере Internet Archive.
10. **Сторы.** Сборки для Google Play и iOS (если будут) могут не содержать адаптер Stremio и вообще поиск раздач (feature flag), чтобы листинг оставался «плеер для своих медиа». Решение отложить до ревью юриста.

Ещё раз: это не юридическая консультация. Перед публичным релизом с поиском раздач стоит показать архитектуру и тексты юристу по авторскому праву ЕС и Польши.

---

## 6. Источники

- Jackett: https://github.com/Jackett/Jackett (README: Torznab API, фильтры индексаторов; `src/Jackett.Common/Definitions/internetarchive.yml`)
- Prowlarr: https://github.com/Prowlarr/Prowlarr (`src/Prowlarr.Api.V1/openapi.json`, `src/NzbDrone.Core/IndexerSearch/NewznabRequest.cs`); определения: https://github.com/Prowlarr/Indexers; вики: https://wiki.servarr.com/prowlarr
- Sonarr / Radarr: https://github.com/Sonarr/Sonarr, https://github.com/Radarr/Radarr
- NZBHydra2: https://github.com/theotherp/nzbhydra2
- BitMagnet: https://github.com/bitmagnet-io/bitmagnet, https://bitmagnet.io/, https://bitmagnet.io/setup/installation.html, https://bitmagnet.io/guides/servarr-integration.html
- TorrServer: https://github.com/YouROK/TorrServer (`server/web/api/route.go`)
- Lampa: https://github.com/yumata/lampa-source (`src/core/api/sources/parser.js`)
- qBittorrent: https://github.com/qbittorrent/search-plugins, https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)
- Torznab: https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html; Newznab API: https://newznab.readthedocs.io/en/latest/misc/api/
- Stremio addon SDK: https://github.com/Stremio/stremio-addon-sdk (`docs/protocol.md`, `docs/api/responses/stream.md`, `docs/api/requests/defineStreamHandler.md`)
- Stremio-аддоны: https://github.com/g0ldyy/comet, https://github.com/mhdzumair/MediaFusion, https://github.com/Viren070/AIOStreams, https://github.com/arvida42/jackettio, https://github.com/knightcrawler-stremio/knightcrawler, https://github.com/MunifTanjim/stremthru, https://github.com/TheBeastLT/torrentio-scraper
- BEP 5: https://www.bittorrent.org/beps/bep_0005.html; BEP 9: https://www.bittorrent.org/beps/bep_0009.html; BEP 51: https://www.bittorrent.org/beps/bep_0051.html
- Парсеры: https://github.com/guessit-io/guessit, https://github.com/platelminto/parse-torrent-title, https://github.com/TheBeastLT/parse-torrent-title, https://github.com/clement-escolano/parse-torrent-title, https://github.com/dreulavelle/PTT, https://github.com/dreulavelle/rank-torrent-name, https://crates.io/crates/parse-torrent-title, https://crates.io/crates/hunch, https://crates.io/crates/torrent-name-parser, https://crates.io/crates/torznab
- librqbit: https://github.com/ikatson/rqbit, https://crates.io/crates/librqbit
- Internet Archive API: https://archive.org/developers/
- Прошлый отчёт: `design/research-plugin-model.md`
