# Undertrained

Undertrained organizes an athlete's recorded activities for analysis and planned sessions for training.

## Language

**Activity selection**:
The activities matching the current filter expression. A selection can be explored without saving it.
_Avoid_: Global filter

**Saved view**:
A named, reusable activity selection definition with display preferences. Its matching activities update as activities are imported or edited.
_Avoid_: Time period, collection

**Folder**:
A flat organizational container for saved views. Folder membership does not add conditions to a view or combine the activities of its views.
_Avoid_: Filter group

**Filter group**:
A set of conditions or nested filter groups joined with AND or OR.

**Working copy**:
The currently edited definition of a saved view. Its changes remain temporary until the athlete explicitly updates the saved view or saves a new one.

**Display preference**:
A choice about how selected activities are shown, such as table columns, sorting, grouping, chart units or aggregation. It does not change which activities belong to the selection.

**Overall fitness**:
The athlete's Fitness, Fatigue and Form calculated from their full recorded training history. A visible date window does not truncate the history used by the calculation.
