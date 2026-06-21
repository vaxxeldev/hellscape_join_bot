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

Для проекта нужен Node.js 24+. В корневом `Dockerfile` используется:

```dockerfile
FROM node:24-bookworm-slim
```

`node:22-alpine` для текущего проекта лучше не использовать: в `package.json` указано `node >=24.0.0`, а база работает через встроенный `node:sqlite`.

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

