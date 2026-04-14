web-build:
	npm --workspace apps/web run build

api-up:
	docker compose up -d backend

platform-up:
	docker compose up -d
