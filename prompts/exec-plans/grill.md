# Grill an ExecPlan

Interrogate the plan for missing context, hidden decisions, ambiguous scope,
invalid sequencing, unsafe side effects, unverifiable acceptance, and recovery
gaps. Repair the document when the answer is derivable. Ask one blocking
question at a time only when owner input would materially change the plan.

End with exactly:

```text
AUTOMATION_STATUS: question|complete|blocked
AUTOMATION_REPLY: <recommended reply or none>
```
