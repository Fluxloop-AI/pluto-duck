# Branch Naming Convention

This document describes the branch naming conventions for this repository.

## Format

```
<type>/<description>
```

- Use lowercase letters and hyphens (`-`) for separating words
- Keep descriptions concise but descriptive

## Branch Types

| Type | Usage | Example |
|------|-------|---------|
| `feature/` | New features or enhancements | `feature/data-upload-ux-improvement` |
| `fix/` | Bug fixes | `fix/upload-validation-error` |
| `hotfix/` | Critical production fixes | `hotfix/critical-auth-bug` |
| `refactor/` | Code improvements (no behavior change) | `refactor/api-cleanup` |
| `docs/` | Documentation only | `docs/update-readme` |
| `chore/` | Build, config, or tooling changes | `chore/update-dependencies` |

## Examples

```bash
# New feature
git checkout -b feature/user-authentication

# Bug fix
git checkout -b fix/login-redirect-issue

# Documentation
git checkout -b docs/api-documentation

# Refactoring
git checkout -b refactor/database-queries
```

## Notes

- Always branch off from `main`
- Delete branches after merging via PR
- Do not push directly to `main`
