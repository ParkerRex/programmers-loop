# Orchestrate a Program

Validate the Program packet, determine its current durable state, and perform
only the next legal transition: research, normalize, converge, order, split,
review, publish a brief, run a child ExecPlan, refresh, or complete. Persist the
result before advancing. Never skip directly from raw research to execution.
