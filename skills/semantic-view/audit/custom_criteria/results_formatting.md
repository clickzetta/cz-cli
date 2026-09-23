# Custom Criteria Audit Results Formatting

## When to Load

Custom Criteria Audit Phase 6: Evaluation complete.

## Output Format

### Summary

```
## Custom Criteria Audit Results

**Criteria Evaluated**: {total_criteria}
**Overall Compliance**: {overall_compliance}%

**Summary by Criterion**:
- ✅ Fully Compliant: {fully_compliant_count}
- ⚠️ Partially Compliant: {partially_compliant_count}
- ❌ Non-Compliant: {non_compliant_count}
```

### Per-Criterion Results

**Fully Compliant (100%):**

```
### ✅ CRITERION {n}: FULLY COMPLIANT

**Your Criterion**: "{original_user_input}"
**Interpretation**: {how_criterion_was_parsed}
**Scope**: Checked {total_checked} {component_type}(s)
**Result**: All components meet this criterion (100% compliance)
```

**Partially Compliant (1-99%):**

```
### ⚠️ CRITERION {n}: PARTIALLY COMPLIANT ({compliance_rate}%)

**Your Criterion**: "{original_user_input}"
**Interpretation**: {how_criterion_was_parsed}
**Scope**: Checked {total_checked} {component_type}(s)
**Result**: ✅ Passing: {passing_count} | ❌ Failing: {failing_count}

**Violations**:
1. {failing_component_1}
   - Issue: {specific_violation}
   - Expected: {expected_value} | Actual: {actual_value}
2. {failing_component_2}
   - Issue: {specific_violation}

**Recommendations**: {how_to_fix_violations}
```

**Non-Compliant (0%):**

```
### ❌ CRITERION {n}: NON-COMPLIANT (0%)

**Your Criterion**: "{original_user_input}"
**Interpretation**: {how_criterion_was_parsed}
**Scope**: Checked {total_checked} {component_type}(s)
**Result**: No components meet this criterion

**All Violations**: {list all failing components}

**Recommendations**: {comprehensive_fix_strategy}
**Priority**: {HIGH/MEDIUM/LOW}
```

### Overall Summary

```
## Overall Compliance Summary

**Compliance by Component Type**:
- Measures: {measure_compliance}%
- Dimensions: {dimension_compliance}%
- Tables: {table_compliance}%
- Relationships: {relationship_compliance}%

**Top Priority Actions**:
1. {highest_impact_fix}
2. {second_priority_fix}
3. {third_priority_fix}
```

## Priority Levels

- **HIGH**: Affects data integrity, query correctness, or breaks functionality
- **MEDIUM**: Affects usability, clarity, or consistency
- **LOW**: Stylistic or documentation improvements

## Next Action

Return to [Custom Criteria Audit](SKILL.md) Phase 7 for next steps.

## Unknown and not-applicable results

For a criterion without enough evidence, report UNKNOWN with the missing evidence and next verification action; for an out-of-scope element report NOT APPLICABLE. Neither is a pass. Show the numerator and applicable, assessable denominator for any percentage, plus unknown counts separately. An empty denominator is N/A, not 100%. Only combine criteria into overall compliance if their weighting and denominator were agreed beforehand; otherwise show per-criterion results.
