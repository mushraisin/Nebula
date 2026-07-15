# Nebula Launcher

Гарний Electron-лаунчер для власних Minecraft-збірок у форматі **Modrinth `.mrpack`**.
Збірки підтягуються **автоматично** з вбудованого репозиторію - будь-хто, хто відкрив
лаунчер, одразу бачить їх і встановлює **в один клік**.

## Можливості

- **Автокаталог збірок**: вбудований репозиторій підтягується сам, доступні збірки видно
  прямо в головній сітці. Кнопка **«Завантажити і грати»** ставить і запускає в один клік.
- **Два способи входу**:
  - **Microsoft / Xbox** (msmc) - ліцензійний акаунт, онлайн-сервери.
  - **Офлайн / піратка** - просто вкажіть нік (offline-UUID як на серверах з online-mode=false).
  Сесія зберігається між запусками.
- **Встановлення `.mrpack`**: завантаження, перевірка sha1-хешів, overrides.
- **Авто-Java**: потрібний JRE (8/17/21...) визначається за версією MC і тягнеться з Adoptium (Temurin).
- **Усі лоадери**: Vanilla, Fabric, Quilt, Forge, NeoForge.
  - Fabric/Quilt/Vanilla - через minecraft-launcher-core.
  - Forge/NeoForge - через офіційний installer (@xmcl) з автоматичним запуском процесорів.
- **Перевірка версій + оновлення**: якщо у репозиторії з'явилась нова версія, лаунчер сам
  показує бейдж «оновлення» і пропонує **Оновити**.

## Запуск у розробці

```bash
npm install
npm start          # або: npm run dev  (з DevTools)
```

## Збірка .exe (Windows installer)

```bash
npm run dist       # результат у папці release/
```

## Хостинг збірок (сайт + бот)

Збірки роздаються з власного сайту (Express-бекенд бота у WSL, публічний через
Cloudflare-тунель `moments.zadrypanka.xyz`). Лаунчер вшитий на маніфест:

```js
// src/main/repo.js
const BUILTIN_REPOS = [
  'https://moments.zadrypanka.xyz/launcher/packs.json'
];
```

**API бота** (`bot/src/web/routes/launcher.js`, таблиця `launcher_packs`):
- `GET /launcher/packs.json` - публічний маніфест (лаунчер читає, порівнює версії).
- `GET /launcher/admin/verify` - перевірка токена.
- `POST /launcher/admin/packs` - створити / оновити пак (upsert по `id`).
- `DELETE /launcher/admin/packs/:id` - видалити.

Адмін-маршрути захищені заголовком `Authorization: Bearer <LAUNCHER_ADMIN_TOKEN>`
(токен у `bot/.env`).

## Адмін-панель у лаунчері

Налаштування → впиши **Адмін-API** (`https://moments.zadrypanka.xyz/launcher`) і
**Адмін-токен** → «Перевірити». Зʼявиться кнопка **Адмін** у бібліотеці:
додавай / редагуй / видаляй збірки (пряме посилання на `.mrpack`, версія, MC-версія,
лоадер). Зміни одразу бачать усі. Оновив `.mrpack` на сайті → підняв `версію` в панелі →
у користувачів спрацьовує **автооновлення** («Оновити і грати»).

Пряме посилання на файл: заливаєш `.mrpack` на сайт → URL виду
`https://moments.zadrypanka.xyz/uploads/modpack/files/<файл>.mrpack` (пробіли → `%20`).

## Додати збірку вручну (локально, без адмінки)

Кнопка **Додати вручну**: свій `packs.json` (репозиторій), пряме посилання на `.mrpack`,
або локальний файл з диска.

## Структура даних

Все зберігається у `%APPDATA%/nebula-launcher/`:

```
config.json          # акаунт, налаштування, встановлені збірки
data/
  shared/            # versions, libraries, assets (спільні)
  instances/<id>/    # mods, config, saves кожної збірки
  java/<major>/      # авто-встановлені JRE
```

## Обмеження / нотатки

- **Forge/NeoForge**: перша установка запускає офіційний installer (процесори) - це може
  зайняти кілька хвилин і вимагає інтернету та Java (ставиться автоматично).
- NeoForge для MC 1.20.1 використовує старе `forge`-іменування - обробляється автоматично.

## Стек

Electron, minecraft-launcher-core (Fabric/Quilt/Vanilla), @xmcl/core + @xmcl/installer
(Forge/NeoForge), msmc (Microsoft auth), adm-zip, Node native fetch/crypto.
