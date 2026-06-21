# Deploy на Bothost через GitHub

## Точка входа

Главный файл после сборки: `dist/index.js`.

Команда запуска:

```bash
npm start
```

В Docker используется:

```bash
node dist/index.js
```

## Node.js

Если Bothost запускает проект через авто-Node окружение, выбирайте:

```text
node:22 Alpine
```

В репозитории хранится готовая папка `dist/`, поэтому авто-запуск `node dist/index.js` работает без отдельного build-step.

Если Bothost запускает проект через Dockerfile, в корневом `Dockerfile` используется:

```dockerfile
FROM node:24-bookworm-slim
```

`package.json` допускает Node.js 20+, потому что Bothost может запускать авто-Node окружение на Node.js 20.

## База данных

В Dockerfile задан путь:

```env
DATABASE_URL=file:/app/data/flood_games.sqlite
```

На Bothost папка `/app/data` должна использоваться для SQLite, чтобы база сохранялась между обновлениями.

Если нужно перенести текущую базу, файл SQLite нужно загрузить на хостинг в:

```text
/app/data/flood_games.sqlite
```

Если файла нет, бот создаст новую базу и применит миграции из `migrations/`.

## Переменные окружения

Настоящий `.env` не нужно заливать в GitHub. Значения задаются в панели Bothost. Список переменных есть в `.env.example`.
