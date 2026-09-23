# Missing Relationships Detection

## When to Load

Best Practices Audit Phase 2d.

## When to Flag

**Only flag when relationships are suspiciously low:**

| Tables | Expected Min Relationships | Flag If          |
| ------ | -------------------------- | ---------------- |
| 2-3    | 1                          | 0 relationships  |
| 4-6    | 2                          | ≤1 relationship  |
| 7+     | 3                          | ≤2 relationships |

**AND** at least one of:
- Multiple tables share FK-like columns (e.g., `ACCOUNT_ID` in 3+ tables)
- Dimension table exists (table with `*_ID` as likely PK) but no relationships point to it

## Detection Steps

1. **Count existing relationships** vs table count
2. **If below threshold**: Identify potential relationship candidates
3. **For each candidate**: Check if at least one table has a primary key on join columns
4. **Report findings with PK status**

## Validating Primary Keys

To verify if a column is a valid primary key, use `cz-cli sql`:

```sql
SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT {column}) AS distinct_values
FROM {database}.{schema}.{table};
```

If `total_rows = distinct_values`, the column is unique and can serve as a primary key.

## Output Format

```
### 🔗 MISSING RELATIONSHIPS ({count})

Relationship count ({current}) is low for {table_count} tables.

| Table A | Table B | Join Columns | PK Status |
|---------|---------|--------------|-----------|
| ORDERS | CUSTOMERS | CUSTOMER_ID → CUSTOMER_ID | ✅ CUSTOMERS has PK |
| LOGS | ACCOUNTS | ACCOUNT_ID → ... | ❌ Neither has PK |

### ⚠️ PRIMARY KEY ISSUES ({count})

At least one table must have a PK on the join columns:

| Table | Suggested PK Columns | Action |
|-------|---------------------|--------|
| ACCOUNTS | ACCOUNT_ID | Verify uniqueness with SQL above |

**Options for missing primary keys:**
1. Verify uniqueness with `cz-cli sql` (SQL above)
2. User provides known primary key columns
```

## Next Steps

To fix: Route to **edit workflow** — **Load** `../../edit/SKILL.md`

Primary keys must be verified/added BEFORE relationships can be created.

## ClickZetta validation boundary

The count threshold above flags sparse models; exceeding it does not prove all required business paths exist. Check supplied query join roles and disconnected components as well. Do not add direct edges when an existing path already expresses the same business relationship: this can create ambiguity.

A declared key does not enforce uniqueness. Check composite keys as tuples using GROUP BY with HAVING COUNT(*) > 1, and separately count NULL key rows. Validate compatible types, right-side uniqueness and unmatched left keys before claiming many-to-one behavior. `cz-cli sv audit --file-path /tmp/model.sv.yaml --data --profile PROFILE` checks declared keys against source data and returns job IDs; undeclared candidate keys require explicit readonly SQL. Use backtick-quoted workspace/schema/table identifiers where needed. Relationships must use supported physical key columns; consult `sv capabilities` before applying edits.
