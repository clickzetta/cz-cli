# Inconsistencies Detection

## When to Load

Best Practices Audit Phase 2b.

## Detection Methodology

### Step 1: Build Cross-Reference Map

Create a comprehensive map of all components from the YAML:

1. **Column Registry** — Map all columns by name across all tables, tracking descriptions, data types, and classifications
2. **Relationship Registry** — Map all relationships, tracking foreign keys and join conditions
3. **Metric Registry** — Map all measures and aggregations, tracking calculation methods

### Step 2: Execute Detection Rules

#### 1. Column Inconsistencies

- **Conflicting descriptions for same column** (PRIORITIZE)
  - Example: `order_date` described differently across tables
  - Severity: MEDIUM

- **Same column name with different data types**
  - Example: `customer_id` is NUMBER in one table, VARCHAR in another
  - Severity: CRITICAL

- **Mixed dimension/measure classification**
  - Example: Column classified as both dimension and measure
  - Severity: HIGH

#### 2. Relationship Inconsistencies

- **Orphaned relationships** (references non-existent tables/columns)
  - Severity: CRITICAL

- **Circular dependencies**
  - Severity: HIGH

- **Conflicting join conditions** (same relationship defined differently)
  - Severity: HIGH

#### 3. Type Inconsistencies

- **Dimension used as measure elsewhere** — Severity: HIGH
- **Measure used as dimension elsewhere** — Severity: HIGH
- **Time dimension type mismatches** (date column not marked as time dimension) — Severity: MEDIUM

#### 4. Aggregation Inconsistencies

- **Same measure with different aggregation functions** — Severity: HIGH
- **Conflicting aggregation logic** — Severity: HIGH

#### 5. Filter Inconsistencies

- **Contradictory filter conditions** — Severity: CRITICAL
- **Overlapping filters with conflicts** — Severity: MEDIUM

### Step 3: Categorize by Severity

- **CRITICAL**: Will cause query failures or wrong results
- **HIGH**: Likely to cause confusion or unexpected behavior
- **MEDIUM**: May cause issues in specific scenarios
- **LOW**: Stylistic inconsistencies

## Output Format

For each inconsistency:

1. **Severity Level**: CRITICAL/HIGH/MEDIUM/LOW
2. **Detection Rule**: Which check detected it
3. **Issue Description**: What the inconsistency is
4. **Locations**: Where the conflicts occur
5. **Impact**: How this affects query results
6. **Resolution**: How to fix the issue

## Context and evidence

Use the registries to compare the same business concept and role. Matching names across unrelated entities, two intentional date roles, or separate sum/average metrics are not alone defects. Classification and severity above are review signals; prove the conflicting interpretation or failure before calling a finding critical. Inspect NULL behavior, units, currency, timezone, grouping grain and predicate scope against supplied SQL and business definitions. Unknown business meaning is an open question, not an invented inconsistency. The deterministic CLI checks are only a subset of this review.
