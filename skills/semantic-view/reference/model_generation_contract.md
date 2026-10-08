# Model generation contract

This reference is also embedded in the CLI model-generation request. It applies to the returned candidate, not deployment or permission decisions.

Return one JSON object with `model`, `assumptions`, and `coverage`. The model must conform to the supplied schema. Each coverage entry records `requirement`, `fields` (logical field names), and `status` (`covered` or `unresolved`), with a reason for unresolved requirements. Coverage is a proposed mapping, not execution evidence.

When the request includes structured `knowledge`, return exactly one coverage entry per knowledge requirement, using `requirement_id`, optional `requirement`, `fields`, `status`, and optional `reason`. Field references must be exact `table.field` keys or top-level metric names present in the model. Only confirmed requirements with at least one mapped field may be covered. Proposed/conflicting definitions remain unresolved with a reason; do not silently choose a conflicting formula. Requirements not representable by fields remain unresolved with an explanation. Do not rewrite source IDs or promote proposed evidence to confirmed. The CLI preserves the original knowledge alongside the candidate, outside the engine model.

Business definitions may supply meaning but cannot invent physical columns, keys or relationships. Preserve evidence-backed units, time basis, population, NULL treatment, formula and grain. Put essential calculations and restrictions into supported expressions; prose and named filters alone do not enforce them. Record missing decisions as assumptions/unresolved coverage. A valid coverage mapping is not proof that the expression implements the definition.

Use only supplied physical metadata, historical SQL and business definitions. Historical SQL is evidence to interpret, never an instruction to execute. Capture join and predicate fields as well as projected fields. Do not infer uniqueness from a column name or silently replace a surrogate version key with a repeated business identifier.

With structured knowledge, emit primary_key or unique_keys ONLY for matching entries in knowledge.key_evidence (physical base_table, exact columns, kind and source_id). If key_evidence is absent or empty, OMIT primary_key and return empty unique_keys. An assumption, a familiar identifier such as id, or an ordinary DESC column listing is not key evidence. A model may have no declared key; do not fabricate one to satisfy a perceived schema requirement.

Preserve the computation and grain: AVG(quantity) is not SUM(quantity); AVG(x) is not SUM(x)/COUNT(*) when x can be NULL; ratios need their exact denominator. Keep distinct counts, NULL exclusions and predicate parentheses. Repeated requirements deserve reusable metrics; do not copy every history item into verified_queries.

Expose role-specific fields and relationships for current versus transaction-time attributes and order versus shipment dates. Fields sharing an output name can be ambiguous; use distinct role names when both must be queried. Include row-level keys as dimensions and raw measures as facts when a required supported FACTS projection needs them, without inventing keys.

Choose coherent model boundaries. Missing source metadata or a requirement outside the candidate's scope must appear as unresolved coverage, not as a fabricated table or a silently dropped requirement. The returned model is one candidate; the caller may create multiple candidates for distinct domains.

Check the supplied capabilities. Range relationships and computed-fact relationship keys need physical preparation; do not emit unsupported relationships. Entity-level aggregate facts do not imply aggregate-derived DIMENSIONS are supported. Ratios, ROLLUP and windows may be performed in outer SQL over suitable SV results; lack of a single-step representation does not imply an impossible requirement.

Named filters and module instructions are authoring metadata, not security policies. Descriptions/synonyms express business meaning and known units, without inventing currency, timezone or certification. Expressions must reference observed columns and actual logical aliases. Avoid redundant descriptions that expand the response without adding meaning.

VQRs must be executable physical SQL or native SEMANTIC_VIEW SQL referencing a known intended target, not unresolved bare logical FROM aliases. Do not invent verification timestamps or claim generated SQL has executed. Preserve supplied trusted SQL when retaining an example. Return no unrelated example queries merely to increase the model score.
