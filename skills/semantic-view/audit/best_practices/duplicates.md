# Duplicates Detection

## When to Load

Best Practices Audit Phase 2c.

## Purpose

Identify duplicate instructions between `module_custom_instructions`/`custom_instructions` fields and core semantic model elements (descriptions, synonyms, sample values, metrics, filters).

## Detection Methodology

### Step 1: Extract Custom Instructions

Extract all custom instructions from the semantic view YAML:

1. **Module Custom Instructions** — sql_generation, question_categorization, and other module-specific instructions
2. **Custom Instructions** (legacy field) — General instructions for SQL generation

### Step 2: Extract Core Semantic Model Elements

1. **Descriptions** — Table, column, metric, and filter descriptions
2. **Synonyms** — Table and column synonyms
3. **Sample Values** — Column sample values
4. **Metrics** — Metric definitions, aggregation functions, expressions
5. **Filters** — Filter definitions, conditions, predicates

**EXCLUSION**: Do NOT compare custom instructions against VQRs. VQRs serve a different purpose (example question-SQL pairs).

### Step 3: Detect Duplicate Instructions

Compare custom instructions against core model elements:

- **Check if instruction repeats description content** (>85% similarity)
- **Check if instruction repeats synonym information** (>85% similarity)
- **Check if instruction repeats sample values** (>85% similarity)
- **Check if instruction repeats metric logic** (>85% similarity)
- **Check if instruction repeats filter logic** (>85% similarity)

### Step 4: Categorize Findings

- **Exact duplicates**: Instruction repeats model element verbatim (100% match)
- **High similarity**: Instruction conveys same information in different words (>85%)
- **Partial overlap**: Instruction partially repeats model information (50-85%)

## Output Format

For each duplicate:

1. **Type**: Description/Synonym/Sample Value/Metric/Filter duplication
2. **Instruction Location**: module_custom_instructions.{module} OR custom_instructions
3. **Instruction Text**: The duplicated instruction text
4. **Already in Model**: Where this information already exists
5. **Similarity Score**: Measured percentage and method, or a qualitative band with evidence
6. **Impact**: Why duplication is problematic
7. **Resolution**: Recommendation to remove from instructions

## Resolution Strategy

Duplicated information should be **removed from custom instructions** and kept only in core semantic model elements:

1. **Single Source of Truth** — Prevents conflicting information
2. **Easier Maintenance** — Update in one place only
3. **Better Organization** — Information lives in its natural location
4. **Clearer Instructions** — Custom instructions focus on unique guidance

## Important Constraints

**DO NOT recommend migrating custom_instructions to module_custom_instructions.**

- Both fields are valid
- Do NOT flag the use of custom_instructions as a duplicate issue
- Focus ONLY on identifying duplicate content between instructions and model elements

## ClickZetta execution and interpretation

Perform the instruction-to-model comparison explicitly after reading the model; `cz-cli sv audit` does not implement this complete semantic comparison. The percentages above are rubric bands, not measured probabilities. Report exact matches directly; for semantic similarity give the matching passages and rationale, and only report a numeric score when a documented scoring method was actually used. Before removal verify that the retained model field is consumed by the intended query client and that the instruction contains no extra scope or exception. Apply authorized corrections through `sv edit`; a review-only request does not authorize mutation.

### Additional expression checks

The CLI also reports duplicate field expressions and ambiguous synonyms. Keep these separate from duplicate instructions. Equivalent expressions may intentionally have different business roles, units, access modifiers, relationship paths or non-additive boundaries. Do not merge them without checking those differences and their dependents.
