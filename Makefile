.PHONY: dev engine frontend test build install spelling scan-check install-autostart uninstall-autostart

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

# Unattended displays: start auto-mapper at login (engine, web app, output fullscreen on the projector).
AGENT := $(HOME)/Library/LaunchAgents/dev.ericdahl.auto-mapper.plist
install-autostart:
	@mkdir -p $(HOME)/Library/LaunchAgents $(HOME)/.auto-mapper
	@sed -e 's|@SCRIPT@|$(CURDIR)/scripts/autostart.sh|' -e 's|@LOG@|$(HOME)/.auto-mapper/autostart.log|' \
		scripts/autostart.plist > $(AGENT)
	launchctl bootout gui/$$(id -u) $(AGENT) 2>/dev/null || true
	launchctl bootstrap gui/$$(id -u) $(AGENT)
	@echo "Installed: auto-mapper starts at login. Log: ~/.auto-mapper/autostart.log"

uninstall-autostart:
	launchctl bootout gui/$$(id -u) $(AGENT) 2>/dev/null || true
	rm -f $(AGENT)

# A real scan on the rig (make dev running, output window fullscreen on the projector): coverage and
# surface count (#15).
scan-check:
	uv run python scripts/scan_check.py
