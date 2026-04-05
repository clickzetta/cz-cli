## ADDED Requirements

### Requirement: Flow DAG inspection
The system SHALL provide commands to inspect Flow task DAG structure.

#### Scenario: Get flow DAG
- **WHEN** user runs `cz-cli task flow dag TASK_ID`
- **THEN** system returns nodes and dependency edges for the specified Flow task

### Requirement: Flow node lifecycle operations
The system SHALL provide commands to create/remove and wire flow nodes.

#### Scenario: Create flow node
- **WHEN** user runs `cz-cli task flow create-node TASK_ID --name transform --type python`
- **THEN** system creates a node in the flow task

#### Scenario: Remove flow node
- **WHEN** user runs `cz-cli task flow remove-node TASK_ID --name transform`
- **THEN** system removes the specified node and related edges

#### Scenario: Bind and unbind flow dependency
- **WHEN** user runs bind/unbind operations
- **THEN** system creates or removes dependency edges between flow nodes

### Requirement: Flow node content and configuration operations
The system SHALL support node-level detail, content save, and configuration save operations.

#### Scenario: Get node detail
- **WHEN** user runs `cz-cli task flow node-detail TASK_ID --node NODE_ID`
- **THEN** system returns node detail including content and defaults

#### Scenario: Save node content
- **WHEN** user runs `cz-cli task flow node-save TASK_ID --node NODE_ID --content "..."`
- **THEN** system saves node content successfully

#### Scenario: Save node configuration
- **WHEN** user runs `cz-cli task flow node-save-config TASK_ID --node NODE_ID`
- **THEN** system saves node configuration with defaults and optional overrides

### Requirement: Flow submit and instance inspection
The system SHALL support flow submission and flow node instance status inspection.

#### Scenario: Submit flow
- **WHEN** user runs `cz-cli task flow submit TASK_ID`
- **THEN** system submits/publishes the flow task

#### Scenario: List flow node instances
- **WHEN** user runs `cz-cli task flow instances --flow FLOW_ID --instance FLOW_INSTANCE_ID`
- **THEN** system returns node instance status details for that flow run

### Requirement: AI-friendly parameter minimization for flow
The system SHALL support name-first UX and derive IDs when possible.

#### Scenario: Node name first
- **WHEN** user provides `node_name` but not `node_id`
- **THEN** system resolves `node_id` via DAG lookup when tool chain allows

#### Scenario: Strict schema fallback
- **WHEN** derivation is not possible and target tool requires explicit ID fields
- **THEN** system returns a clear required-argument error before invocation
