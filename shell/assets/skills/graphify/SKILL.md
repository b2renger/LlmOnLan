---
name: graphify
description: >
  Map a project as a knowledge graph: read its code and docs with the file
  tools, then write graphify-out/graph.json (graphify's node-link format:
  nodes, links, communities, EXTRACTED/INFERRED/AMBIGUOUS confidence) and a
  one-page graphify-out/GRAPH_REPORT.md. Use when the user says "graphify",
  "map this project", "knowledge graph", "graph of the code", "how is this
  project put together", or asks for graph.json. Needs only glob, grep, read
  and write: no Python, no shell, no web.
license: Apache-2.0
---

# graphify (file tools only)

Adapted from graphify v0.9.71 (Graphify-Labs/graphify, Apache-2.0; see NOTICE).
The original runs Python, a shell and subagents. Here YOU are the extractor and
you have only file tools. Never ask for Python, a shell, a package, a subagent,
a CDN or the web: none of them exist here. Do not write a graph.html.

## What you make

Two files, at the project root, and nothing else:

1. `graphify-out/graph.json`: the graph (schema below).
2. `graphify-out/GRAPH_REPORT.md`: a one-page summary.

## Steps

1. Plan with `todo_write`: list files, extract, group, write JSON, check, report.
2. **List the files** with `glob`. Skip `.git/`, `node_modules/`, `graphify-out/`,
   `dist/`, `build/`, `.venv/`, `venv/`, `__pycache__/`, lock files, `*.min.js`,
   binaries and media. Read READMEs and entry points (package.json, main files)
   first, then the source folder by folder. More than ~60 files: take the 60
   that matter most and name what you left out in the report.
3. **Extract, one file at a time.** A file over ~400 lines: `grep` it for its
   definitions (`^\s*(export |async |def |class |function |fn |func )`) and its
   imports, and `read` only around what matters. For each file:
   - one **file node**, and one node per important symbol (exported functions,
     classes, top-level definitions; at most ~10 per file, skip tiny helpers);
   - for docs: one node per named concept or entity. The WHY of a decision goes
     in a `rationale` attribute on that concept's node, never in a node of its own;
   - the links you can see (relations and confidence below);
   - if the file has YAML frontmatter, copy `source_url`, `captured_at`,
     `author`, `contributor` onto its nodes.
   Only what you read: never invent a file, a symbol or a call.
4. **Communities.** Put every node in one community: nodes that are tightly
   linked (one feature, one folder, one flow) share it. 3 to 12 communities,
   numbered 0, 1, 2... from the largest. Give each a short `community_name`.
5. **Write** `graphify-out/graph.json` with `write`, in one go.
6. **Check it:** `read` it back. It must be valid JSON; every `source` and
   `target` must be a node `id`; no `id` twice. Fix with `edit`.
7. **Write** `graphify-out/GRAPH_REPORT.md`.

## Node ids

Lowercase, only `[a-z0-9_]`. A file's id is its path without the extension,
every folder kept, each part lowercased with anything else turned into `_`,
joined by `_`: `src/auth/session.py` is `src_auth_session`. A symbol's id is the
file id + `_` + the symbol, the same way: `ValidateToken` in it is
`src_auth_session_validatetoken`. A top-level `setup.py` is `setup`. The same
thing always gets the same id; never add `_2`, `_c1` or any suffix.

## Relations (use only these)

- From the code itself: `contains` (file to symbol), `method` (class to method),
  `imports`, `imports_from`, `re_exports`, `inherits`, `implements`, `calls`.
  A `calls` link goes from the caller to the callee, never reversed, and never
  between two languages.
- About meaning: `references`, `cites`, `conceptually_related_to`,
  `shares_data_with`, `semantically_similar_to`, `rationale_for`.

`semantically_similar_to`: two things that solve the same problem with no import,
call or citation between them. INFERRED, 0.65 to 0.95. Only when it is not obvious.

## Confidence (on EVERY link)

- `EXTRACTED`, `confidence_score` 1.0: it is written in the source (an import,
  a call, a citation, "see section 3").
- `INFERRED`: a reasonable inference. `confidence_score` is exactly one of
  0.95 (direct structural evidence: a shared data structure, a named cross-file
  reference), 0.85 (strong inference), 0.75 (reasonable), 0.65 (weak, same
  theme), 0.55 (speculative but plausible). Never 0.5.
- `AMBIGUOUS`, 0.1 to 0.3: unsure. Keep it and flag it; do not drop it.

## graph.json

```json
{
  "directed": false,
  "multigraph": false,
  "graph": {},
  "nodes": [
    {"id": "src_auth_session", "label": "session.py", "file_type": "code",
     "source_file": "src/auth/session.py", "source_location": "L1",
     "community": 0, "community_name": "Auth"},
    {"id": "src_auth_session_validatetoken", "label": "ValidateToken()",
     "file_type": "code", "source_file": "src/auth/session.py",
     "source_location": "L42", "community": 0, "community_name": "Auth"}
  ],
  "links": [
    {"source": "src_auth_session", "target": "src_auth_session_validatetoken",
     "relation": "contains", "confidence": "EXTRACTED", "confidence_score": 1.0,
     "source_file": "src/auth/session.py", "source_location": "L42", "weight": 1.0}
  ],
  "hyperedges": []
}
```

- The list is `links`, not `edges`.
- `file_type` is exactly one of `code`, `document`, `paper`, `image`,
  `rationale` (an idea, a principle, a mechanism), `concept` (a named concept).
- `source_file` is the path from the project root, with `/`.
  `source_location` is `L<line>`, or null.
- `hyperedges` (optional, at most 3): 3 or more nodes that share one flow or
  protocol that pairwise links do not show:
  `{"id": "auth_flow", "label": "Auth flow", "nodes": ["a", "b", "c"],
  "relation": "participate_in", "confidence": "INFERRED",
  "confidence_score": 0.75, "source_file": "src/auth/session.py"}`.
  `relation` is `participate_in`, `implement` or `form`.
- Aim for 30 to 300 nodes. The viewer draws at most 1000 nodes and 5000 links.

## GRAPH_REPORT.md

Short, in this order. Count each node's links from the list you wrote.

```markdown
# Graph Report - <project name>

## Summary
- N nodes · M links · K communities
- Extraction: X% EXTRACTED · Y% INFERRED · Z% AMBIGUOUS
- Files read: F (left out: ...)

## God Nodes (most connected)
1. `label` - n links            (the top 5 to 10)

## Surprising Connections
- `a` --relation--> `b` [INFERRED] - why it matters (links between communities)

## Communities
### Community 0 - "Name"
Nodes (n): label, label, ...

## Ambiguous Edges - Review These
- `a` --relation--> `b` [AMBIGUOUS]

## Suggested Questions
- 3 to 5 questions this graph can answer
```

## Updating an existing graph

If `graphify-out/graph.json` exists, read it first. Keep the nodes of the files
you did not re-read, replace those of the files you did, and keep every id that
still names the same thing. If the new graph is smaller, say why in the report.

## Seeing it

LlmOnLan draws graph.json with its Graph viewer: on the Computer, the
**Graph** box (＋, Show, Graph) takes the JSON as its code. Colour is the
community; a dashed link is INFERRED, a dotted one AMBIGUOUS.
