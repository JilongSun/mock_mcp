.PHONY: build start stop

build:
	pnpm build:v1:inspector
	pnpm build:v2:inspector
	pnpm build:console

start:
	pnpm console

stop:
	pnpm console:stop
