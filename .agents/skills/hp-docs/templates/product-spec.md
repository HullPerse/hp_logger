# {{PROJECT_NAME}} Product Spec

Optional single source of truth for the product feature set. Created for projects with a large product scope; when unused, features live in `.docs/features/*.md` and DECISIONS.md.

## Role of this file

- The single source of truth for what is in scope: the agent never adds features absent from this file without passing the disposition gate.
- Updated only on explicit user request; implementation details live in feature files.
- Document split: here - "what we build and why"; `.docs/features/*.md` - "how and in what status".

## Product

{{PRODUCT_DESCRIPTION}}

<!--
Example:
A native Windows application for disk analysis and safe cleaning.
No cloud, no telemetry, no permanent deletion by default.
-->

## Features

<!--
Example:
- F1: Background drive scanning with progress - live size and counters in the header.
- F2: Findings classification - cache/build/user_data/system/protected with colors from DESIGN.md.
- F3: Quick Clean checkbox presets - declarative JSON, deletion to Recycle Bin only.
-->

## Not building

<!--
Explicit rejections with reasons: so agents stop proposing rejected items.
Example:
- CLI mode: a second executable is out of scope; the desktop app covers the same flows.
-->
