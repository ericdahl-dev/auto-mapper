.PHONY: dev engine frontend test build install spelling

install:
	uv sync
	cd frontend && npm install

# Engine on :8765, Vite on :5173 (proxies /api and /ws). Open http://localhost:5173
dev:
	@trap 'kill 0' EXIT; uv run python -m engine & (cd frontend && npx vite) & wait

engine:
	uv run python -m engine

frontend:
	cd frontend && npx vite

test:
	uv run pytest -q
	cd frontend && npx tsc --noEmit && npx vitest run

build:
	cd frontend && npm run build

# American spelling check (same as CI): the org's spelling-dialect tool.
spelling:
	pipx run --spec git+https://github.com/ericdahl-dev/spelling-dialect@v1.0.0 spelling-dialect --dialect american .
