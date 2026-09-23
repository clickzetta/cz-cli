# Semantic View Description Guidelines

This document defines rules and examples for generating descriptions for semantic view components. These guidelines ensure consistency, clarity, and business value across all generated descriptions.

---

## General Rules (Apply to All Descriptions)

### Tone & Style

Descriptions should:
- **Be business-facing, not engineering-facing**
- **Avoid raw SQL syntax**
- **Avoid internal table or pipeline names**
- **Be declarative and precise**
- **Avoid vague phrasing**

### Avoid Phrases Like

❌ "Used for reporting"\
❌ "Contains data about…"\
❌ "Important metric"\

### Instead, Clearly State

✅ What it represents\
✅ At what grain\
✅ What is included\
✅ What is excluded\
✅ Any important caveats\

### Structural Expectations

Every description should answer:
1. **What is this?**
2. **What business concept does it represent?**
3. **What is its grain?**
4. **What is included?**
5. **What is excluded (if relevant)?**
6. **Any limitations or caveats?**

### Things to Avoid

❌ SQL expressions\
❌ Physical schema references\
❌ Pipeline details\
❌ Speculation\
❌ Overly verbose language\

### Recommended Length

| Component | Suggested Length |
|-----------|------------------|
| Semantic View | 3–6 sentences |
| Table | 2–4 sentences |
| Single Component | 1–3 sentences |

---

## Workflow A: Generate Semantic View Description

### When to Use

Use this workflow when generating a description for the entire semantic view.

### What It Must Cover

1. **Business domain**
2. **Primary purpose**
3. **High-level grain context**
4. **Scope** (what is covered)
5. **Major exclusions** (if relevant)
6. **Intended audience** (optional)

### Recommended Structure

```
This semantic view supports [business domain] analytics.
It represents data at the [grain] level.
It enables analysis of [primary use cases].
It includes [core subject areas].
It excludes [major exclusions if relevant].
```

### ✅ Strong Example

> This semantic view supports Sales and Revenue analytics for North America. It models transactions at the order line level and enables consistent reporting of revenue, margin, customer performance, and product trends. The view standardizes certified financial metrics and enforces regional access controls. It excludes manually adjusted transactions not recorded in the ERP system.

### ❌ Weak Example (Avoid)

> This view contains sales data used for reporting purposes.

**Why weak:** Vague, no grain, no scope definition, uses "contains data" anti-pattern.

---

## Workflow B: Generate Table Description

### When to Use

Use this workflow when generating a description for a logical table within the semantic view.

### What It Must Cover

1. **Business entity represented**
2. **Explicit grain** (mandatory)
3. **Analytical role**
4. **Relationship context** (if helpful)

### Recommended Structure

```
Represents [business entity].
Grain: [explicit grain].
Used for [primary analytical purpose].
Related to [other key entities if helpful].
```

### ✅ Example – Orders Table

> Represents completed sales orders at the order line level. Each row corresponds to a single product within an order. This table is the primary fact table for revenue and margin analysis and links to Customers and Products for dimensional analysis.

### ✅ Example – Customers Table

> Represents unique customers. Grain: one row per customer. Contains demographic and segmentation attributes used for customer performance and lifecycle analysis.

### ❌ Weak Example (Avoid)

> Contains customer data.

**Why weak:** Uses "contains" anti-pattern, no grain specified, no analytical purpose.

---

## Workflow C: Generate Column/Component Description

Use this workflow when generating a description for a single component, such as:
- Metric
- Measure
- Dimension
- Time dimension
- Relationship
- Filter
- Identifier

---

### A. Metric / Measure

#### Must Include

1. **Business meaning**
2. **Calculation summary** (in plain language)
3. **Aggregation behavior**
4. **Units or currency** (if applicable)
5. **Key caveats**

#### Recommended Structure

```
Represents [business definition].
Calculated as [plain language explanation].
Aggregated using [SUM/AVG/etc].
Currency/unit: [if applicable].
Includes/excludes [important rules].
```

#### ✅ Example – Revenue

> Represents total recognized sales revenue from completed orders. Calculated as the sum of order amounts excluding taxes and refunds. This metric is fully additive across all dimensions and reported in USD.

#### ❌ Weak Example (Avoid)

> Revenue amount from sales.

**Why weak:** No calculation details, no aggregation behavior, no exclusions.

---

### B. Dimension

#### Must Include

1. **What it categorizes**
2. **Allowed values** (if applicable)
3. **Business purpose**

#### ✅ Example – Customer Segment

> Categorizes customers based on onboarding classification. Values include Enterprise, SMB, and Startup. Used to segment revenue and customer performance reporting.

#### ❌ Weak Example (Avoid)

> Customer segment field.

**Why weak:** No values specified, no business purpose.

---

### C. Time Dimension

#### Must Include

1. **What timestamp it represents**
2. **Time zone** (if relevant)
3. **Business purpose**

#### ✅ Example – Order Date

> Date when the order was completed. Stored in UTC and used as the primary time reference for revenue reporting and time-based analysis.

#### ❌ Weak Example (Avoid)

> Order date column.

**Why weak:** No timestamp meaning, no time zone, no purpose.

---

### D. Relationship

#### Must Include

1. **Cardinality**
2. **Business meaning**

#### ✅ Example

> Defines a many-to-one relationship between Orders and Customers. Each order is associated with exactly one customer, while a customer may have multiple orders.

#### ❌ Weak Example (Avoid)

> Links orders to customers.

**Why weak:** No cardinality specified, no business context.

---

### E. Filter

#### Must Include

1. **What it filters**
2. **Filter logic** (in plain language)
3. **Business purpose**

#### ✅ Example – Active Customers Filter

> Filters to customers who have placed at least one order in the last 12 months. Excludes dormant or deactivated accounts. Used to focus analysis on currently engaged customers.

---

### F. Identifier

#### Must Include

1. **What entity it identifies**
2. **Uniqueness constraint**
3. **Business purpose**

#### ✅ Example – Customer ID

> Unique identifier for each customer. Each value represents exactly one customer across all orders and transactions. Used as the primary key for customer-level analysis and joins.

---

## Cross-Workflow Consistency Rules

All descriptions must:

✅ **Explicitly state grain** where applicable\
✅ **Use business terminology**\
✅ **Avoid implementation details**\
✅ **Avoid inventing missing information**\
✅ **Maintain consistent tone**\

---

## Tone Calibration (Enterprise Standard)

### ✅ Preferred Tone

> Represents the total cost of goods sold associated with completed order lines.

**Characteristics:**
- Professional
- Precise
- Declarative
- Business-focused

### ❌ Avoid Conversational Tone

> This field tells you how much it cost to make the product.

**Why avoid:**
- Too casual
- Imprecise ("tells you")
- Ambiguous ("the product")

---

## Summary Table

| Workflow | Focus | Required Elements |
|----------|-------|-------------------|
| **Semantic View** | Entire model | Domain + Grain + Scope + Purpose |
| **Table** | Business entity | Entity meaning + Grain |
| **Single Component** | Metric/Column | Meaning + Behavior + Context |

---

## Quick Reference Checklist

Before finalizing any description, verify:

- [ ] No SQL syntax or physical table names
- [ ] Grain is explicitly stated (for views and tables)
- [ ] Business meaning is clear
- [ ] Aggregation behavior specified (for metrics)
- [ ] Uses declarative, precise language
- [ ] Appropriate length (3–6 sentences for views, 2–4 for tables, 1–3 for components)
- [ ] Includes what is excluded (if relevant)
- [ ] Professional, enterprise tone

## Evidence boundary

Examples illustrate wording, not facts about the user's model. Only state currency, timezone, exclusions, uniqueness, certification or access controls when supplied business definitions or verified metadata support them. Label unknowns rather than copying example assumptions. Lengths are guidance, not a scoring target. Preserve existing correct business meaning.
