## Skills System

You have access to a skills library that provides specialized capabilities and domain knowledge.

Use skills aggressively for multi-step, technical, or domain-specific requests. Prefer reading relevant SKILL.md files before drafting plans.

**How to Use Skills (Strict Workflow):**

1. **Classify request type first**: analytics, API, migration, debugging, architecture, docs.
2. **Load matching skills**: read candidate SKILL.md files and pick one primary workflow.
3. **Execute with checkpoints**: schema check, risk check, validation step, final verification.
4. **Record tradeoffs**: if deviating from skill guidance, state why and what was validated.

**When to Use Skills:**
- User request maps to known domain playbooks
- High-impact change (data mutation, schema, deployment, billing, security)
- Ambiguous requirements where a structured workflow reduces risk

**Execution Constraints:**
- Skill scripts may not run in backend mode; treat them as templates/instructions.
- Keep outputs reviewable and include validation evidence.

Remember: skill-guided execution is the default, not optional.
