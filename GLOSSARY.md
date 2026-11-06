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
A choice about how selected activities are shown, such as table columns, sorting or grouping. It is part of a saved view and does not change which activities belong to the selection.

**Chart setting**:
A chart's own choice on the charts page, such as its metric, granularity or time span, remembered per saved view on each device. It is not part of the saved view, so changing it never modifies the view.

**Time span**:
How far back a chart looks inside the activity selection, ending today.
_Avoid_: Duration, period

**Overall fitness**:
The athlete's Fitness, Fatigue and Form calculated from their full recorded training history. A visible date window does not truncate the history used by the calculation.

**Ride**:
The activity the rider starts, pauses and finishes, whether guided by a workout or ridden freely.

**Recording**:
The measured samples and timing events collected during a ride, together with its journal and exported activity files.

**Workout plan**:
The timed steps a ride follows, with their power targets, cadence cues and notes.

**Trainer**:
The ride's power source, which may also accept commands to control resistance.

**Pedal stroke**:
A trainer reading above zero watts. A measured zero means the trainer is at rest; an absent reading is silence.

**Manual pause**:
A pause requested by the rider, ended by Resume.

**Automatic pause**:
A pause caused by stopped pedaling or prolonged trainer silence, ended by the next pedal stroke.

**ERG control**:
The rider's choice to let the app set trainer resistance to follow the workout's power target.

**Release**:
A request for the trainer to stop holding an ERG target. It remains a request until the trainer confirms it.
