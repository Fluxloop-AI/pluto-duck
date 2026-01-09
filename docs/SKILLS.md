## Pluto Duck Skills (SKILL.md) 가이드

Pluto Duck의 deep agent는 **Skills 시스템**을 통해 “재사용 가능한 작업 레시피/워크플로우”를 SKILL.md 형태로 로드해서 사용합니다.
Skills는 **프롬프트에 전부 로드하지 않고**, 먼저 “카탈로그(이름/설명/경로)”만 노출한 뒤 필요할 때 해당 SKILL.md를 읽는 **progressive disclosure** 패턴을 따릅니다.

---

## 1) 스킬이 저장되는 위치(중요)

### 1.1 에이전트가 보는 가상 경로(Virtual FS)

- **User skills(공용)**: `/skills/user/skills/<skill-name>/SKILL.md`
- **Project skills(프로젝트 전용)**: `/skills/projects/<project_id>/skills/<skill-name>/SKILL.md`

에이전트는 `read_file`, `ls` 같은 파일 툴을 사용할 때 위 가상 경로를 사용합니다.

### 1.2 실제 디스크 경로(Data dir)

기본 `data_dir.root`:
- macOS: `~/Library/Application Support/PlutoDuck`
- 그 외: `~/.pluto-duck`

실제 저장 위치:

- **User skills(공용)**:
  - `{data_dir.root}/deepagents/user/skills/<skill-name>/SKILL.md`
- **Project skills(프로젝트 전용)**:
  - `{data_dir.root}/deepagents/projects/<project_id>/skills/<skill-name>/SKILL.md`

`data_dir.root`는 환경변수로 오버라이드할 수 있습니다:

```bash
export PLUTODUCK_DATA_DIR__ROOT="/some/path"
```

---

## 2) 기본 스킬 배포 방식(개발팀 → 모든 유저)

개발팀이 “기본 제공 스킬”을 앱에 번들로 포함해두면, 앱 시작 시 유저 디렉토리로 **seed(복사)** 됩니다.

### 2.1 개발팀이 추가하는 위치(번들 템플릿)

- `backend/pluto_duck_backend/templates/skills/<skill-name>/SKILL.md`

### 2.2 유저 디렉토리로 seed(복사)되는 규칙

- 대상: `{data_dir.root}/deepagents/user/skills/`
- 정책: **이미 존재하는 스킬 폴더는 덮어쓰지 않음** (유저 커스터마이징 보호)
- 구현: `backend/pluto_duck_backend/app/core/config.py`의 `_ensure_default_agent_skills(...)`

즉,
“templates/skills에 새 스킬 추가 → 유저가 앱을 실행/재시작 → 해당 스킬 폴더가 없으면 자동 복사” 흐름입니다.

---

## 3) 에이전트가 스킬을 로드하는 방법

스킬은 “직접 실행”이 아니라 **SKILL.md를 읽어서 절차를 따르는** 형태입니다.

- `SkillsMiddleware`가 매 턴(또는 세션 시작 시) 스킬 디렉토리를 스캔해서
  - `name`, `description`, `path`를 수집
  - 시스템 프롬프트에 “Available Skills” 목록으로 주입
- 스캔 로직은 `agent/core/deep/skills/load.py`의 `list_skills()`가 담당합니다.

### 3.1 Project skill 우선순위

동일한 `name`의 스킬이 둘 다 존재할 경우:
- **project skill이 user skill을 override** 합니다.

---

## 4) SKILL.md 포맷(최소 규약)

각 스킬은 폴더 하나이며, 최소 `SKILL.md`가 있어야 합니다.

```text
<skill-name>/
  SKILL.md
  references/   (optional)
  assets/       (optional)
  scripts/      (optional)
```

### 4.1 YAML frontmatter (필수)

SKILL.md 최상단에 YAML frontmatter를 둡니다:

```markdown
---
name: sql-analysis
description: Workflow for answering analytical questions with DuckDB using Pluto Duck tools...
---
```

- `name`: 소문자/숫자/하이픈. 폴더명과 동일해야 합니다.
- `description`: “언제 이 스킬을 써야 하는지”를 충분히 포함해야 합니다. (스킬 트리거의 핵심)

---

## 5) 보안/정책 (Pluto Duck backend 모드)

### 5.1 스킬 스크립트 실행

- 스킬 폴더 안에 `scripts/`가 있어도, **Pluto Duck backend 모드에서는 스크립트 실행이 불가**합니다.
- 따라서 스킬은 “가이드/템플릿/워크플로우”로 사용하고, 실제 작업은 제공된 tool들로 수행합니다.

### 5.2 HITL(승인)

다음 행위들은 승인 대상일 수 있습니다:
- 파일 쓰기/수정: `write_file`, `edit_file`
- 서브에이전트/태스크: `task`

스킬은 이를 전제로 "거부 시 재시도 금지" 같은 운영 규칙을 포함하는 것이 좋습니다.

---

## 6) 개발팀 운영 가이드(추천)

### 6.1 “기본 제공 스킬” 추가하기

1. `backend/pluto_duck_backend/templates/skills/<skill-name>/SKILL.md` 추가
2. `name`과 폴더명이 일치하는지 확인
3. 앱 시작 후 `{data_dir.root}/deepagents/user/skills/`에 seed되는지 확인

### 6.2 “프로젝트 전용 스킬” 제공하기(선택)

프로젝트별로 강제하고 싶은 스킬은:
- `{data_dir.root}/deepagents/projects/<project_id>/skills/` 아래에 배치합니다.
- 동일 이름의 user skill보다 우선 적용됩니다.

---

## 7) 트러블슈팅

### 스킬이 목록에 안 보임

- 폴더 구조가 `<skill-name>/SKILL.md`인지 확인
- YAML frontmatter가 `--- ... ---` 형태로 올바른지 확인
- `name`이 폴더명과 일치하는지 확인
- `{data_dir.root}`가 예상한 경로인지 확인(환경변수 override 여부)


