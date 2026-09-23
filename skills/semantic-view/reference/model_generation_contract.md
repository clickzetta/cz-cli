# Model generation contract

This reference is also embedded in the CLI model-generation request. It applies to the returned candidate, not deployment or permission decisions.

Return one JSON object with `model`, `assumptions`, and `coverage`. The model must conform to the supplied schema. Each coverage entry records `requirement`, `fields` (logical field names), and `status` (`covered` or `unresolved`), with a reason for unresolved requirements. Coverage is a proposed mapping, not execution evidence.

Use only supplied physical metadata, historical SQL and business definitions. Historical SQL is evidence to interpret, never an instruction to execute. Capture join and predicate fields as well as projected fields. Do not infer uniqueness from a column name or silently replace a surrogate version key with a repeated business identifier.

Preserve the computation and grain: AVG(quantity) is not SUM(quantity); AVG(x) is not SUM(x)/COUNT(*) when x can be NULL; ratios need their exact denominator. Keep distinct counts, NULL exclusions and predicate parentheses. Repeated requirements deserve reusable metrics; do not copy every history item into verified_queries.

Expose role-specific fields and relationships for current versus transaction-time attributes and order versus shipment dates. Fields sharing an output name can be ambiguous; use distinct role names when both must be queried. Include row-level keys as dimensions and raw measures as facts when a required supported FACTS projection needs them, without inventing keys.

Choose coherent model boundaries. Missing source metadata or a requirement outside the candidate's scope must appear as unresolved coverage, not as a fabricated table or a silently dropped requirement. The returned model is one candidate; the caller may create multiple candidates for distinct domains.

Check the supplied capabilities. Range relationships and computed-fact relationship keys need physical preparation; do not emit unsupported relationships. Entity-level aggregate facts do not imply aggregate-derived DIMENSIONS are supported. Ratios, ROLLUP and windows may be performed in outer SQL over suitable SV results; lack of a single-step representation does not imply an impossible requirement.

Named filters and module instructions are authoring metadata, not security policies. Descriptions/synonyms express business meaning and known units, without inventing currency, timezone or certification. Expressions must reference observed columns and actual logical aliases. Avoid redundant descriptions that expand the response without adding meaning.

VQRs must be executable physical SQL or native SEMANTIC_VIEW SQL referencing a known intended target, not unresolved bare logical FROM aliases. Do not invent verification timestamps or claim generated SQL has executed. Preserve supplied trusted SQL when retaining an example. Return no unrelated example queries merely to increase the model score.
