<!-- 9662a618-818a-48c0-b73b-ed8b11fb9e8b 1734ae28-415d-4534-9de8-1ef6f8c073d7 -->
# Project Pluto-Duck: Open-Core Development Roadmap

This roadmap outlines the plan to transform the Pluto-Duck project into a powerful open-source tool with a sustainable commercial offering.

## Phase 1: Open-Source Core Development (Target: Next 3 Months)

**Objective:** Create a stable, user-friendly, and powerful local-first data analytics tool that becomes the heart of the project.

### 1. Codebase Restructuring & Simplification

- **Action:** Isolate the current `backend/` directory into a new, public Git repository. This will be the home of the open-source project.
- **Action:** Audit and refactor the existing code to create a clean separation between the core engine and presentation layers.
    - **Focus Area:** `backend/app/api/` and `backend/app/flows/`. Remove endpoints and logic that were tightly coupled to the previous complex frontend.
    - **Core Logic to Preserve:** The AI agent logic in `backend/agent/`, the `dbt` integration, and the DuckDB management scripts (e.g., `initialize_duckdb.py`) will be preserved and enhanced.

### 2. Enhance "Local-First" Core Features

- **Action:** Evolve data loading scripts into a primary, user-facing **Data Ingestion Feature**.
    - **Goal:** Provide a simple CLI command (e.g., `pluto-duck ingest --from-postgres <uri>`) to easily pull data from various sources into the local DuckDB instance.
- **Action:** Frame the `dbt` integration as a key feature for **Local Data Transformation**.
    - **Goal:** Allow users to model their ingested data using dbt. Provide clear documentation and example models to lower the barrier to entry.

### 3. Define a Clean Public API & CLI

- **Action:** Redesign the API in `backend/app/main.py` to be clean, public-facing, and optimized for the new chat-based frontend and third-party integrations.
    - **Key Endpoints:**
        - `POST /api/v1/query`: Accepts a natural language query and returns a job ID.
        - `GET /api/v1/query/{run_id}`: Streams results, logs, and final data.
- **Action:** Create a simple Command Line Interface (CLI) for essential functions like `ingest` and `run-dbt`.

### 4. Project Packaging and Documentation

- **Action:** Craft a high-quality `README.md` that clearly articulates the project's vision: "Your Personal, AI-Powered Data IDE. Secure, local, and powerful."
- **Action:** Add a `LICENSE` file (e.g., Apache 2.0 or AGPL-3.0) and a `CONTRIBUTING.md` guide to encourage community participation.
- **Action:** Prepare the project for distribution via PyPI (`pip install pluto-duck`) and Docker Hub.

## Phase 2: Delivering the End-User Experience (Target: Months 3-6)

**Objective:** Develop a simple, open-source frontend to provide a complete and intuitive local user experience, and launch the unified product to the community.

- **Action:** Develop a minimal, open-source, chat-based frontend within a `frontend/` directory in the main OSS repository. This provides a complete, out-of-the-box experience for users.
- **Action:** Publicly launch the unified project (backend + frontend), promoting it as a complete, ready-to-use local data analytics tool.

## Phase 3: Commercial Expansion (Target: Months 6+)

**Objective:** Based on the successful adoption of the free, unified local tool, introduce a paid cloud offering with an advanced UI and value-added features for teams.

- **Action:** Begin development of "Pluto-Duck Cloud," a managed service that extends the capabilities of the open-source version.
- **Action:** Develop a separate, more feature-rich, closed-source frontend for the commercial version, focusing on team collaboration, advanced dashboards, and enterprise features. This becomes a key differentiator from the open-source offering.
- **Key Premium Features to Develop:**

    1.  **Managed Scheduling:** Automate data pipeline runs.
    2.  **Team Collaboration:** Enable shared projects, queries, and dashboards.
    3.  **Enterprise Connectors:** Provide connectors for data warehouses like Snowflake, BigQuery, etc.
    4.  **Advanced Security & Governance:** Implement role-based access control and audit logs.

### To-dos

- [ ] Restructure the backend into a standalone OSS project, separating core logic from old UI dependencies.
- [ ] Enhance data ingestion and dbt integration as core, user-facing features of the local-first experience.
- [ ] Define and implement a clean, public-facing API and a basic CLI for core operations.
- [ ] Create high-quality documentation (README, CONTRIBUTING) and package the project for easy distribution (PyPI, Docker).