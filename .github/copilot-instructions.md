# GitHub Copilot Cost-Efficiency & iPad Workspace Guardrails

You must strictly adhere to these instructions to optimize token spending, minimize excessive code generation, and respect iPadOS mobile Safari constraints.

## 1. Token Budget & Code Generation Discipline
* **Never rewrite entire files:** When providing updates or bug fixes, only output the specific changed functions or blocks of code. Do not reprint boilerplate or unmodified segments.
* **Skip conversational filler:** Omit polite prefaces, generic explanations, and conversational sign-offs. Provide clean, directly applicable code snippets immediately.
* **Write single-purpose functions:** Keep helper logic modular. Smaller functions prevent massive code context bloat during iterative prompt updates.

## 2. Monolithic Clean-Architecture Boundaries
* **Strict Logic-UI Isolation:** All core business logic, API drivers, configuration parsing, and utility handlers must be written inside server-side directories (`/app/api/*` or `/lib/*`). 
* **Pure Presentation Components:** Keep frontend UI files (`.tsx`) strictly focused on layout and data display. Never allow database queries, state machines, or direct backend utility functions to blend into visual component code.

## 3. iPadOS Mobile Safari Ergonomics
Every time you generate or refactor a user interface component, you must enforce tablet-safe layouts:
* **Dynamic Viewports:** Use dynamic viewport utilities (`h-dvh`, `max-h-dvh`) instead of legacy screen-height classes (`h-screen`, `100vh`) to prevent Safari navigation bars from breaking layout boundaries.
* **Anti-Zoom Safeguards:** All interactive text fields, search boxes, and textareas must be set to a minimum font size of `text-base` (16px) to block iOS from auto-zooming the window.
* **Touch-Target Sizing:** Every button, tap region, or link menu must maintain a minimum hit boundary of 48x48px. 
* **Zero Hover Reliance:** Never hide functional details or actions behind hover-only states (`hover:`). All interactive metrics or indicators must be displayed statically or triggered by explicit tap/click elements.

## 4. Deterministic Type & Error Handling
* Always validate incoming payloads or state maps using strict Zod schemas.
* Wrap integration functions in clean try/catch blocks to ensure processing failures gracefully surface error messages back to the layout without freezing the active workspace runtime.