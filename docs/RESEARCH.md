# Research and existing overlap

Checked 2026-10-07. [Freeplane #1603](https://github.com/freeplane/freeplane/issues/1603) describes over 10,000 categories and manually enriched spreadsheet columns. A [recent response](https://github.com/freeplane/freeplane/issues/1603#issuecomment-5219306297) proposes manual Calc → TreeLine → Freeplane conversion. This is evidence of a workflow problem, not validation of BranchSheet demand.

Freeplane already provides XML/XSLT exports, scripting and add-ons. Its [native mm2xls exporter](https://github.com/freeplane/freeplane/blob/3a76de18523993a55bf885190438bffef38662a5/freeplane/src/external/resources/xslt/mm2xls_utf8.xsl) creates a workbook from text/attributes without a prior annotated workbook or node-ID reconciliation. The same file was present at current master `73f5b6e0a02424e7c4421e1017f5f00c288af76a` during research.

[mm2docs](https://github.com/Nobby-n/mm2docs/blob/d46f23427488b411ea86d57d97ba177a4d077586/mm2docs.py#L338) handles Freeplane/USDM Excel conversion with template sheets and positional USDM IDs. Other activity/work-package exporters and generic joins can cover related needs. Spreadsheet lookups, Power Query and short scripts can implement exact-ID reconciliation. BranchSheet is a convenience workflow with bounded file validation and visible removed/restored handling, not a novel algorithm or superior general converter.

IDs are [map-local](https://docs.freeplane.org/user-documentation/links-to-nodes.html). Root ID alone cannot distinguish copied maps. The official NodeBuilder can substitute IDs on collision, so BranchSheet rejects malformed raw maps itself before any native test consumer is relevant.

Native references:

- [Freeplane 1.13.3 release](https://github.com/freeplane/freeplane/releases/tag/release-1.13.3)
- [Official command-line/profile options](https://docs.freeplane.org/getting-started/Command-line_options_and_configuration.html)
- [Pinned menu/keyboard actions](https://github.com/freeplane/freeplane/blob/3a76de18523993a55bf885190438bffef38662a5/freeplane/src/external/resources/xml/mindmapmodemenu.xml)
- [Pinned NodeTextBuilder](https://github.com/freeplane/freeplane/blob/3a76de18523993a55bf885190438bffef38662a5/freeplane/src/main/java/org/freeplane/features/text/NodeTextBuilder.java)
- [LibreOffice native filter names](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html)
- [UNO TableSortField](https://api.libreoffice.org/docs/idl/ref/structcom_1_1sun_1_1star_1_1table_1_1TableSortField.html)
- [UNO macro execution modes](https://api.libreoffice.org/docs/idl/ref/namespacecom_1_1sun_1_1star_1_1document_1_1MacroExecMode.html)
- [UNO update modes](https://api.libreoffice.org/docs/idl/ref/namespacecom_1_1sun_1_1star_1_1document_1_1UpdateDocMode.html)
