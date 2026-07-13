# Run the complete Program loop

Validate current durable state, perform one legal transition, persist it, and
validate again. The legal sequence is initialize, funnel, research, normalize,
converge, order, split, adversarial review, publish a brief, run one child
ExecPlan, refresh, sync docs, and either select another slice or complete. Never
skip from raw inputs directly to execution.
