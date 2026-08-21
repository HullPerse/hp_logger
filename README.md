# hp_logger

Структурированный логгер для Bun/Node: уровни, redaction, настраиваемые цвета, запись в файл, глобальные и модульные настройки, интеграции с серверными фреймворками.

## Установка

```bash
bun add hp_logger
# или
npm install hp_logger
```

## Быстрый старт

```ts
import { createLogger } from "hp_logger";

const logger = createLogger({
  settings: {
    level: "info",
    mode: "pretty",
  },
});

// модуль с собственными настройками
const auth = logger.module("auth", { level: "debug" });

auth.info("user registered", { userId: 42 });
```

## Настройки

Глобальные настройки задаются при `createLogger`, модульные - через `.module(name, settings)` или изменяются на лету через `.settings(patch)`.

| Настройка | Описание | По умолчанию |
| --- | --- | --- |
| `level` | Минимальный уровень: debug, info, success, warn, error | `info` (или `LOG_LEVEL` из env) |
| `mode` | `pretty` цветной вывод или `json` структурированный | `pretty` |
| `colors` | Цвета по уровням или `false` чтобы выключить все | стандартные |
| `enabled` | Мастер-выключатель: `false` пропускает все записи | `true` |
| `redactKeys` | Регулярка ключей, которые маскируются | стандартная (password, token и т.д.) |
| `redactDepth` | Максимальная глубина вложенности контекста при маскировке | `2` |
| `maxMessageLength` | Обрезание сообщения | `2000` |
| `showTimestamp` | Показывать время в pretty-выводе | `true` |
| `showAuthor` | Показывать имя модуля в pretty-выводе | `true` |
| `showLevel` | Цветной префикс уровня `[INFO]`/`[ERROR]` в pretty-выводе | `false` |
| `formatTimestamp` | `iso` или `local` формат времени | `iso` |
| `file` | Запись в файл: `{ enabled, path, mode, rotation, ... }` или `false` | `false` |
| `async` | Асинхронная запись с батчингом или `false` | `false` |
| `filters` | Функции фильтрации записей | `[]` |

### Цвета

```ts
const logger = createLogger({
  settings: {
    colors: {
      info: "cyan",      // поменять цвет
      error: "red",
      warn: false,        // выключить цвет для warn
    },
  },
});
```

Все цвета выключаются через `colors: false`.

### Запись в файл

```ts
const logger = createLogger({
  settings: {
    file: {
      enabled: true,
      path: "logs/app.log",      // или "logs" с rotation: "daily"
      mode: "json",              // "json" по умолчанию или "pretty" (читаемый текст без цветов)
      rotation: "daily",         // файлы по дням: logs/{yyyy-mm-dd}/log_NNN.log
      flushIntervalMs: 1000,
      maxBufferSize: 100,
    },
  },
});
```

### Префикс уровня

```ts
const logger = createLogger({
  settings: {
    showLevel: true, // [INFO] [auth] сообщение
  },
});
```

Уровень пишется цветом своего уровня (info - blue, error - red и так далее).

### Модули и контекст

```ts
const logger = createLogger({ settings: { level: "info" } });

const http = logger.module("http");                       // наследует глобальные
const auth = logger.module("auth", { level: "debug" });   // переопределяет
const child = auth.child({ requestId: "abc" });           // дополнительный контекст

logger.settings({ level: "warn" });                       // изменить на лету
```

## Интеграции

Все интеграции логируют запросы: метод, путь, статус, длительность, correlation id. Уровень зависит от статуса: 2xx/3xx info, 4xx warn, 5xx error. `/health` и `/metrics` можно исключить через `skipPaths`.

### Elysia

```ts
import { Elysia } from "elysia";
import { createLogger } from "hp_logger";
import { elysiaPlugin } from "hp_logger/elysia";

const logger = createLogger({ settings: { level: "debug" } });

const app = new Elysia()
  .use(elysiaPlugin(logger, { skipPaths: ["/health", "/metrics"] }))
  .get("/", () => "ok");
```

### Bun.serve

```ts
import { createLogger } from "hp_logger";
import { bunServe } from "hp_logger/bun";

const logger = createLogger();

Bun.serve({
  fetch: bunServe(async (request) => {
    return new Response("ok");
  }, logger),
});
```

### Node http

```ts
import { createServer } from "node:http";
import { createLogger } from "hp_logger";
import { nodeServer } from "hp_logger/node";

const logger = createLogger();

createServer(
  nodeServer((request, response) => {
    response.end("ok");
  }, logger)
).listen(3000);
```

### Hono

```ts
import { Hono } from "hono";
import { createLogger } from "hp_logger";
import { honoMiddleware } from "hp_logger/hono";

const logger = createLogger();
const app = new Hono();

app.use(honoMiddleware(logger));
app.get("/", (c) => c.text("ok"));
```

### Fastify

```ts
import Fastify from "fastify";
import { createLogger } from "hp_logger";
import { fastifyPlugin } from "hp_logger/fastify";

const logger = createLogger();
const fastify = Fastify();

await fastify.register(async (instance) => {
  await fastifyPlugin(instance, logger);
});
```

## Метрики (Prometheus)

Zero-dependency метрики в формате Prometheus: `Counter`, `Gauge`, `Histogram`, `Registry`. Нужны для `/metrics` на сервере без внешних клиентских библиотек.

```ts
import { Counter, Gauge, Histogram, Registry } from "hp_logger";

const registry = new Registry();

const requests = new Counter({
  help: "Total number of HTTP requests",
  labelNames: ["method", "status"],
  name: "http_requests_total",
  registers: [registry],
});

const duration = new Histogram({
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  help: "HTTP request duration in milliseconds",
  labelNames: ["method"],
  name: "http_request_duration_ms",
  registers: [registry],
});

const clients = new Gauge({
  help: "Connected WebSocket clients",
  name: "ws_clients",
  registers: [registry],
});

requests.inc({ method: "GET", status: "200" });
duration.observe({ method: "GET" }, 12);
clients.set(5);

// Текст в формате Prometheus: # HELP, # TYPE, сэмплы, гистограммы с _bucket/_sum/_count
const text = registry.metrics();
```

- `Counter` - монотонно растущий счётчик, `inc(labels?, value = 1)`.
- `Gauge` - значение вверх/вниз, `set`/`inc`/`dec`.
- `Histogram` - распределение наблюдений по bucket'ам, `observe(labels, value)`.
- `Registry` - собирает метрики, отдаёт текст; имена метрик должны быть уникальны, имя соответствует `[a-zA-Z_:][a-zA-Z0-9_:]*`.

## Глобальные ошибки

```ts
import { createLogger, installGlobalErrorHandlers } from "hp_logger";

const logger = createLogger();
installGlobalErrorHandlers(logger);
```

`unhandledRejection` и `uncaughtException` пишутся через логгер.

## Команды пакета

```bash
bun test            # тесты
bun run typecheck   # проверка типов
bun run lint        # линт
bun run build       # сборка dist для публикации
```

## Лицензия

MIT
