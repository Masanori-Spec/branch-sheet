# BranchSheet

Refresh a category-tree workbook after a Freeplane node moves or changes its label. BranchSheet rebuilds the tree columns and carries three manual text columns by exact node ID: **Keyword**, **Description**, and **Owner**.

The offline workflow passed the complete [browser-to-native gate](https://github.com/Masanori-Spec/branch-sheet/actions/runs/37573003523) at `65c3838b6def76299effb6f7cf768929ad2bdad9`: 58 source/worker checks, four sandboxed offline browser tests, actual Freeplane edits and Calc workbook consumption, six native-edited fault controls, and 20,000 active plus 100 removed rows. Independent artifact review verified the actual downloads, exact values/types, input/output hashes, complete ID sets, and print/native evidence.

This revision polishes the Japanese title, chooser presentation and Details-button wrapping. It preserves the exporter/native oracles and repeats the same end-to-end workflow for the updated HTML.

## Offline app

Download [dist/branchsheet.html](dist/branchsheet.html) and open that saved file in Chromium. It contains its runtime and dependency notices; no installation, local server, account or internet connection is required. The browser gate opens the actual HTML through `file://` with networking offline and checks that no external requests occur.

Choose a saved map and, optionally, your previous BranchSheet workbook. Select **Match and review**, inspect the changes, and save the new XLSX and hashed JSON review receipt. The Japanese/English interface processes the selected pair in a cancellable Worker and shows 50 rows per page. ID/label search and filters affect only the preview: every export contains the full reviewed Active and Removed sets. **Other tree change** identifies path, depth or order changes without an added, renamed, moved or restored status; its exact IDs are included separately in the browser receipt; **Unchanged** requires all six reserved values to match. **Details** shows a row’s full strings and prior tree values; **Print this page** prints only the current bounded preview, with an explicit shortening notice. Replacing an input, cancelling or clearing invalidates downloads. Inputs are kept only in the open page; there is no autosave or upload.

**Load example** uses synthetic map text plus a recorded native Calc-saved workbook. It demonstrates duplicate labels, a rename/move, a new blank node, and removed annotations.

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

For the optional source CLI, use Node.js 22. Output files must be new paths. The CLI reads the explicitly selected files and creates new outputs; it has no map-writing, network, formula-evaluation, or synchronization feature. Both outputs are required. If writing the second output fails, the first may already exist; no existing file is overwritten.

## Deliberately narrow file contract

- One UTF-8 Freeplane map with a single root, unique nonempty IDs, and ordinary `TEXT` node cores. Missing/duplicate IDs, cloned/shared-content nodes, encrypted nodes, typed/localized cores, rich node cores (including the case-insensitive `<html>` TEXT prefix recognized by Freeplane), formula-looking cores, DTD or entity declarations and processing instructions are rejected.
- Notes, details, attributes, styles, icons, links, and other non-core decoration are excluded from the projection. They are never followed, evaluated, or included as annotations. This is not a whole-map export.
- Prior workbooks must use this tool’s exact three-sheet schema: **Active**, **Removed**, and **_BranchSheet**. Only the three annotation columns are editable. Annotation cells must be text or empty; numeric, boolean, error and formula cells are rejected rather than coerced. Literal `007` and `=1+1` are text values.
- The workbook is rebuilt with simple formatting. Explicit multiline values receive taller rows, capped at 409 points; unusually long/wrapped values may still need a row-height adjustment in Calc. Arbitrary workbook formats, comments, rich-text formatting, merges, named expressions, formulas, hyperlinks, external relationships, macros, controls, unknown sheets/columns/ZIP parts and phonetic strings are unsupported. Whole rows may be reordered.
- String runs retain their text while run formatting is discarded. Styles, themes and document properties are checked for known part/root types, well-formed XML and forbidden active content, then excluded from the projection; this is not a full validator of those formatting grammars. Cell, worksheet, workbook, relationship and content-type structures use explicit supported vocabularies.
- Calc 7.3.7.2 compatibility recognizes only its observed empty protection placeholder, false date-compatibility flag, unused PNG/JPEG MIME declarations, exact metadata relationship spelling and relationship-part MIME overrides. One workbook-level extension is allowed: URI `{7626C862-2A13-11E5-B345-FEFF819CDC9F}`, exactly one LibreOffice `extCalcPr` leaf, and `stringRefSyntax="CalcA1ExcelA1"`. It is discarded when rebuilding. Additional attributes/children, other extension values/locations, actual image parts, nonempty protection and every formula still reject.
- Root ID checks only a map family. Copies retaining identical IDs cannot be distinguished. The hidden reserved snapshot detects accidental structural edits, not malicious coordinated edits or authenticity. Regenerated child IDs are new nodes; old IDs move to Removed. No title/path guesses recover lost identity.

Capacity: at most **20,000 active nodes**, **20,000 removed nodes**, depth 64, 16 MiB per input file, 96 MiB total expanded XLSX, 48 MiB per ZIP part, 48 ZIP entries, and 24 MiB projected text. IDs are limited to 128 UTF-16 units, labels 2,048, paths 8,192, and each annotation 16,000. Oversize inputs fail closed. This target is not a guarantee for every 20,000-node map: deep/long-text maps can reach another bound first.

The accepted browser run used 20,000 active nodes, 100 removals/additions/renames, and checked 60,300 annotation strings. Its core refresh took 7.812 seconds; the complete core check peaked at about 484 MiB RSS and produced a 1,433,771-byte workbook. Actual Calc reopening and checking the browser-downloaded scale workbook took 102.473 seconds. Earlier core measurements varied up to about 16 seconds and 562 MiB; the browser test enforces a 120-second processing timeout. These measurements describe the synthetic corpus and particular runners, not a guarantee for every device or input.

## Verification and scope

`npm test` builds the standalone app and checks ID-based transitions, exact Unicode/whitespace/text escaping, sorted rows, malformed map/workbook rejection and ZIP bounds. It includes a byte-identical, synthetic Calc-saved workbook with recorded provenance and independent literal expected values. `npm run test:scale` records the bounded synthetic capacity result.

The [native method](docs/NATIVE_METHOD.md) uses the official digest-pinned Freeplane application with a disposable GUI profile, plus actual Calc/UNO string entry, sorting, saving and reopening. It compares native values/types to a separately authored literal table and retains precise negative-control artifacts. Native applications run only in the reviewed hosted CI gate, not while processing user inputs.

The accepted run used official Freeplane 1.13.3 and LibreOffice 7.3.7.2. Its original 90-member evidence archive was independently verified against GitHub’s SHA-256 digest `8bc92133e81da6214c94ed24f69ef4e8e74ff2579d9ba7f6f2526acb9ae02245`. Initial/refreshed/repeated/filtered/unchanged/restored and 20,000-row XLSX downloads were bound to the exact native-tested bytes; Calc reopened the initial, refreshed, restored and scale downloads. Repeated/filtered/unchanged downloads were verified byte-identical to the refreshed download. Japanese/English print PDFs and the one-row print-scope PDF were checked page by page; native screenshots show the corrected multiline row height.

The browser suite records actual Chromium launch arguments and rejects sandbox-disabling flags. It checks every case for page/console errors and external requests, keyboard file selection, responsive left/right table access, enlarged text, cancellation and superseded real reads/Worker results. The proof covers the synthetic corpus, recorded browser/fonts and bounded schema, not general Excel compatibility, arbitrary formatting, every Freeplane feature, or copied-map identity.

## Why this exists

[Freeplane issue #1603](https://github.com/freeplane/freeplane/issues/1603) describes a large category tree with manually enriched spreadsheet columns. Native exports, scripting, generic joins and other converters already cover parts of this workflow. BranchSheet’s modest difference is a bounded, explicit refresh by map-local ID with reserved-column checks and removed/restored annotation handling. Demand for this exact product is unvalidated; it is not a new join algorithm. See [research and overlap](docs/RESEARCH.md).

Third-party dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No license is granted here for the original project code. Freeplane and LibreOffice are test-only applications fetched/installed from official sources; their binaries are not included in source artifacts.
