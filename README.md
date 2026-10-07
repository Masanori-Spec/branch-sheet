# BranchSheet

Refresh a category-tree workbook after a Freeplane node moves or changes its label. BranchSheet rebuilds the tree columns and carries three manual text columns by exact node ID: **Keyword**, **Description**, and **Owner**.

This repository is a **native-feasibility candidate**. The core tests and synthetic 20,000-node scale check pass locally and in hosted CI. The complete Freeplane producer is independently verified. The [sixth native attempt](https://github.com/Masanori-Spec/branch-sheet/actions/runs/37566177136) also passed actual Calc text entry, descending whole-row sorting, XLSX saving and reopening with exact strings/types. The product then rejected Calc's export metadata. A narrow, byte-fixture-tested compatibility correction accepts the observed inert metadata and successfully refreshes that actual workbook locally. The refreshed workbook's native reopening, controls and native20k capacity gate remain pending; there is no browser interface or completed-product claim.

## Workflow

1. Export a saved, plain-text-node `.mm` map to a new BranchSheet `.xlsx` workbook.
2. In Calc, edit the three amber annotation columns. Keep values as text. Sorting complete rows is supported; changing the six reserved tree columns, sheet names, headers, or hidden metadata is rejected.
3. After editing the map in Freeplane, provide the new saved `.mm` plus the previous BranchSheet workbook. Nodes match only by their exact IDs.
4. Review the JSON change report and the new workbook. New IDs receive blank annotations. Disappeared IDs and their last tree values/annotations remain on **Removed**. A restored ID recovers its annotations.

The source XML sibling order determines rows. The Path column is a JSON array of labels, so labels containing slashes or newlines remain unambiguous. Duplicate labels never join rows. Visual left/right layout is not a spreadsheet order.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/cli.mjs categories.mm --out first.xlsx --report first-review.json
node src/cli.mjs updated.mm --prior first-annotated.xlsx --out refreshed.xlsx --report refreshed-review.json
```

Use Node.js 22. Output files must be new paths. The CLI reads the explicitly selected files and creates new outputs; it has no map-writing, network, formula-evaluation, or synchronization feature. Both outputs are required. If writing the second output fails, the first may already exist; no existing file is overwritten.

## Deliberately narrow file contract

- One UTF-8 Freeplane map with a single root, unique nonempty IDs, and ordinary `TEXT` node cores. Missing/duplicate IDs, cloned/shared-content nodes, encrypted nodes, typed/localized cores, rich node cores (including the case-insensitive `<html>` TEXT prefix recognized by Freeplane), formula-looking cores, DTD/entities and processing instructions are rejected.
- Notes, details, attributes, styles, icons, links, and other non-core decoration are excluded from the projection. They are never followed, evaluated, or included as annotations. This is not a whole-map export.
- Prior workbooks must use this tool’s exact three-sheet schema: **Active**, **Removed**, and **_BranchSheet**. Only the three annotation columns are editable. Annotation cells must be text or empty; numeric, boolean, error and formula cells are rejected rather than coerced. Literal `007` and `=1+1` are text values.
- The workbook is rebuilt with simple formatting. Arbitrary workbook formats, comments, rich-text formatting, merges, named expressions, formulas, hyperlinks, external relationships, macros, controls, unknown sheets/columns/ZIP parts and phonetic strings are unsupported. Whole rows may be reordered.
- String runs retain their text while run formatting is discarded. Styles, themes and document properties are checked for known part/root types, well-formed XML and forbidden active content, then excluded from the projection; this is not a full validator of those formatting grammars. Cell, worksheet, workbook, relationship and content-type structures use explicit supported vocabularies.
- Calc 7.3.7.2 compatibility recognizes only its observed empty protection placeholder, false date-compatibility flag, unused PNG/JPEG MIME declarations, exact metadata relationship spelling and relationship-part MIME overrides. One workbook-level extension is allowed: URI `{7626C862-2A13-11E5-B345-FEFF819CDC9F}`, exactly one LibreOffice `extCalcPr` leaf, and `stringRefSyntax="CalcA1ExcelA1"`. It is discarded when rebuilding. Additional attributes/children, other extension values/locations, actual image parts, nonempty protection and every formula still reject.
- Root ID checks only a map family. Copies retaining identical IDs cannot be distinguished. The hidden reserved snapshot detects accidental structural edits, not malicious coordinated edits or authenticity. Regenerated child IDs are new nodes; old IDs move to Removed. No title/path guesses recover lost identity.

Capacity: at most **20,000 active nodes**, **20,000 removed nodes**, depth 64, 16 MiB per input file, 96 MiB total expanded XLSX, 48 MiB per ZIP part, 48 ZIP entries, and 24 MiB projected text. IDs are limited to 128 UTF-16 units, labels 2,048, paths 8,192, and each annotation 16,000. Oversize inputs fail closed. This target is not a guarantee for every 20,000-node map: deep/long-text maps can reach another bound first.

The local synthetic capacity check used 20,000 active nodes, 100 removals/additions/renames, and checked 60,300 annotation strings. The strict-reader run took about 13.1 seconds for refresh, used about 554 MiB peak RSS for the full check, and produced a 1.41 MB workbook. These are one cloud-machine measurement, not a browser performance claim; CI repeats the check and separately opens it in Calc.

## Verification and scope

`npm test` checks ID-based transitions, exact Unicode/whitespace/text escaping, sorted rows, malformed map/workbook rejection and ZIP bounds. It includes a byte-identical, synthetic Calc-saved workbook with recorded provenance and independent literal expected values. `npm run test:scale` records the bounded synthetic capacity result.

The [native method](docs/NATIVE_METHOD.md) uses the official digest-pinned Freeplane application with a disposable GUI profile, plus actual Calc/UNO string entry, sorting, saving and reopening. It compares native values/types to a separately authored literal table and retains precise negative-control artifacts. Native applications run only in the reviewed hosted CI gate, not while processing user inputs.

No live synchronization, original-map edits, general Excel compatibility, arbitrary workbook formatting preservation, formula evaluation, or map-identity authentication is promised. Native acceptance remains pending until the actual CI artifact is inspected.

## Why this exists

[Freeplane issue #1603](https://github.com/freeplane/freeplane/issues/1603) describes a large category tree with manually enriched spreadsheet columns. Native exports, scripting, generic joins and other converters already cover parts of this workflow. BranchSheet’s modest difference is a bounded, explicit refresh by map-local ID with reserved-column checks and removed/restored annotation handling. Demand for this exact product is unvalidated; it is not a new join algorithm. See [research and overlap](docs/RESEARCH.md).

Third-party dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No license is granted here for the original project code. Freeplane and LibreOffice are test-only applications fetched/installed from official sources; their binaries are not included in source artifacts.
