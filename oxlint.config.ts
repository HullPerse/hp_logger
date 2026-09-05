import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core, antiSlop],
  ignorePatterns: core.ignorePatterns,
  options: {
    typeAware: true,
    typeCheck: true,
  },
  overrides: [
    {
      files: ["src/**/__test__/**", "src/**/*.test.ts"],
      rules: {
        "prefer-destructuring": "off",
        "require-await": "off",
        "typescript/await-thenable": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "anti-slop/no-unknown-parameters": "off",
        /* Test assertions cast observed values and check representations:
           the cast and the typeof ARE the behavior under test, so per-cast
           SAFETY comments and boundary parsing add churn with no safety. */
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        /* Test fixtures mirror observed shapes; explicit table types are
           the test contract, chained casts assert the pipeline output. */
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-chained-type-assertions": "off",
      },
    },
    {
      files: ["src/integrations/**"],
      rules: {
        "node/callback-return": "off",
      },
    },
    {
      files: ["src/api/logger.api.ts"],
      rules: {
        "node/callback-return": "off",
        "promise/prefer-await-to-callbacks": "off",
      },
    },
    {
      files: ["src/core/pipeline.core.ts"],
      rules: {
        /* dispatchToTransport exists to keep an async frame off the hot
           path; swallowing the rejection inline is the point, not a
           chaining habit. */
        "promise/prefer-await-to-then": "off",
      },
    },
    {
      files: ["src/worker/worker.transport.ts"],
      rules: {
        /* The rule targets the DOM window API. Bun worker threads take
           postMessage(data) - a targetOrigin argument would break the call. */
        "unicorn/require-post-message-target-origin": "off",
      },
    },
    {
      /* Log data is untyped by contract: context values, redaction walkers,
         serializers, guards and format helpers take unknown at the trust
         boundary and narrow it inline. There is no schema to run without
         adding the runtime dependency this package forbids. */
      files: [
        "src/core/context.core.ts",
        "src/core/entry.core.ts",
        "src/core/pipeline.core.ts",
        "src/format/context.format.ts",
        "src/format/entry.format.ts",
        "src/format/error.format.ts",
        "src/format/table.format.ts",
        "src/format/tag.format.ts",
        "src/format/template.format.ts",
        "src/http/log.server.ts",
        "src/lib/callsite.utils.ts",
        "src/lib/json.utils.ts",
        "src/lib/sampling.utils.ts",
        "src/redact/index.redact.ts",
        "src/resolvers/index.resolver.ts",
        "src/types/logger.d.ts",
      ],
      rules: {
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-conditional-empty-object-spread": "off",
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/no-shape-in-symbol-names": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
    {
      /* Public API and facade delegators: module methods take user context
         under the frozen 1.x types; span/task/watch/metrics reach Logger
         privates through the recorded unknown-typed delegator shape. */
      files: [
        "src/api/console.api.ts",
        "src/api/logger.api.ts",
        "src/api/metrics.api.ts",
        "src/api/span.api.ts",
        "src/api/task.api.ts",
        "src/api/watch.api.ts",
      ],
      rules: {
        "anti-slop/no-unknown-parameters": "off",
        /* Delegators narrow Logger privates and console payloads through
           the recorded shape; per-cast SAFETY comments restate the types. */
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-conditional-empty-object-spread": "off",
      },
    },
    {
      /* Settings merge caller objects and env strings, untyped by contract;
         narrowing happens inline at each consumer. Same boundary rationale. */
      files: ["src/lib/settings.utils.ts"],
      rules: {
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        /* Blocks-then-helpers narrative: resolvers run at call time, after
           module evaluation, so forward references never fire early. */
        "eslint/no-use-before-define": "off",
      },
    },
    {
      /* Frozen 1.x public type contracts: LogContext dictionaries and
         unknown-returning accessors are the documented boundary shape.
         Retyping them breaks the frozen API (DECISIONS 2026-09-05). */
      files: ["src/types/logger.d.ts", "src/types/watch.d.ts"],
      rules: {
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-unknown-returns": "off",
      },
    },
    {
      /* Explicit return types on collect/createLogServer are the public
         owner contract of the hp_logger/http entry; pure inference would
         leak internals into the published .d.ts. */
      files: ["src/http/log.server.ts"],
      rules: {
        "anti-slop/no-known-value-widening": "off",
      },
    },
    {
      /* Watch probe classification carries explicit owner types by design
         (status-code tables, error kinds); span internals narrow through
         the recorded delegator shape. Same frozen-boundary rationale. */
      files: ["src/core/span.core.ts", "src/watch/index.watch.ts"],
      rules: {
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
    {
      /* Transports narrow entries and context shapes at every sink;
         explicit state types are the transport contract. */
      files: [
        "src/testing/capture.transport.ts",
        "src/worker/thread.transport.ts",
        "src/worker/worker.transport.ts",
        "src/writer/base.writer.ts",
        "src/writer/buffer.writer.ts",
        "src/writer/console.writer.ts",
        "src/writer/factory.writer.ts",
        "src/writer/lazyDatabase.writer.ts",
        "src/writer/repeat.writer.ts",
        "src/writer/sqlite.writer.ts",
      ],
      rules: {
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-conditional-empty-object-spread": "off",
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        "unicorn/no-useless-fallback-in-spread": "off",
      },
    },
    {
      /* State, config, and plugin tables merge untyped caller data and
         carry explicit owner types; narrowing is inline at each consumer. */
      files: [
        "src/brain/lru.utils.ts",
        "src/brain/registry.utils.ts",
        "src/brain/ring.utils.ts",
        "src/config/colors.config.ts",
        "src/config/integrations.config.ts",
        "src/config/levels.config.ts",
        "src/lib/color.utils.ts",
        "src/metrics/registry.metric.ts",
        "src/plugins/elysia.plugin.ts",
      ],
      rules: {
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-conditional-empty-object-spread": "off",
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
    {
      /* Allocation-free emptiness checks on the per-entry hot path:
         Object.keys would allocate per log line. Inherited enumerables
         fail safe (treated as non-empty, full path runs). */
      files: ["src/core/context.core.ts", "src/core/entry.core.ts"],
      rules: {
        "eslint/guard-for-in": "off",
        "eslint/no-unreachable-loop": "off",
      },
    },
    {
      /* Sequential dispatch is the FIFO guarantee: each write completes
         before the next starts. Promise.all would break entry ordering
         and first-error-wins semantics. */
      files: ["src/lib/transport.utils.ts"],
      rules: {
        "eslint/no-await-in-loop": "off",
      },
    },
  ],
  rules: {
    curly: "off",
    "no-else-return": "off",
    /* The void operator is banned outright, including statement position:
       fire-and-forget calls stay bare with a comment naming the guard. */
    "no-void": "error",
    "typescript/await-thenable": "error",
    "typescript/consistent-return": "warn",
    "typescript/consistent-type-exports": "off",
    "typescript/dot-notation": "off",
    "typescript/no-array-delete": "off",
    "typescript/no-base-to-string": "off",
    "typescript/no-confusing-void-expression": "off",
    "typescript/no-deprecated": "off",
    "typescript/no-duplicate-type-constituents": "off",
    "typescript/no-floating-promises": "off",
    "typescript/no-for-in-array": "off",
    "typescript/no-implied-eval": "error",
    "typescript/no-meaningless-void-operator": "off",
    "typescript/no-misused-promises": "warn",
    "typescript/no-misused-spread": "off",
    "typescript/no-mixed-enums": "off",
    "typescript/no-redundant-type-constituents": "off",
    "typescript/no-unnecessary-boolean-literal-compare": "off",
    "typescript/no-unnecessary-condition": "error",
    "typescript/no-unnecessary-qualifier": "off",
    "typescript/no-unnecessary-template-expression": "off",
    "typescript/no-unnecessary-type-arguments": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-unnecessary-type-conversion": "off",
    "typescript/no-unnecessary-type-parameters": "off",
    "typescript/no-unsafe-argument": "off",
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-enum-comparison": "off",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-unsafe-unary-minus": "off",
    "typescript/no-useless-default-assignment": "off",
    "typescript/non-nullable-type-assertion-style": "off",
    "typescript/only-throw-error": "off",
    "typescript/prefer-find": "off",
    "typescript/prefer-includes": "off",
    "typescript/prefer-nullish-coalescing": "off",
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-promise-reject-errors": "off",
    "typescript/prefer-readonly": "off",
    "typescript/prefer-readonly-parameter-types": "off",
    "typescript/prefer-reduce-type-parameter": "off",
    "typescript/prefer-regexp-exec": "off",
    "typescript/prefer-return-this-type": "off",
    "typescript/prefer-string-starts-ends-with": "off",
    "typescript/promise-function-async": "off",
    "typescript/related-getter-setter-pairs": "off",
    "typescript/require-array-sort-compare": "off",
    "typescript/require-await": "off",
    "typescript/restrict-plus-operands": "off",
    "typescript/restrict-template-expressions": "off",
    "typescript/return-await": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/strict-void-return": "off",
    "typescript/switch-exhaustiveness-check": "off",
    "typescript/unbound-method": "off",
    "typescript/use-unknown-in-catch-callback-variable": "off",
    "unicorn/filename-case": "off",
    "unicorn/prefer-ternary": "off",
    "unicorn/throw-new-error": "off",
  },
});
