.PHONY: install frontend build verify

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 业务规则验证：事务回滚、压差/次序同口径重算、重复报送退回、存量回填、跨模块台数一致。
verify:
	cd frontend && node scripts/build-verify.cjs && node scripts/dist/verify.mjs
