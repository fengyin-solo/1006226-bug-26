#!/usr/bin/env node
// 验证脚本构建器：用项目自带 esbuild 把 verify.ts 及其依赖打包成 node 可跑的单个 ESM。
// 兼容 CI 里平台二进制与 node_modules 不一致的情况：优先用 @esbuild/<platform> 包。
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const outDir = join(root, 'scripts', 'dist')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const platformPkgs = {
  'linux-arm64': '@esbuild/linux-arm64',
  'linux-x64': '@esbuild/linux-x64',
  'darwin-arm64': '@esbuild/darwin-arm64',
  'darwin-x64': '@esbuild/darwin-x64',
}
const pkg = platformPkgs[`${process.platform}-${process.arch}`]
// node_modules 可能在别的平台上安装（如仓库在 macOS 装包、Linux 容器里跑），
// 优先用当前平台的原生包；没有就退回 esbuild 自带 shim。
const platformBin = pkg && join(root, 'node_modules', pkg, 'bin', 'esbuild')
const bin =
  platformBin && existsSync(platformBin)
    ? platformBin
    : join(root, 'node_modules', 'esbuild', 'bin', 'esbuild')
if (!existsSync(bin)) {
  console.error('找不到可用的 esbuild 二进制，请先 npm install')
  process.exit(2)
}

const entry = join(outDir, 'entry.ts')
writeFileSync(entry, "export * from '@/api/local-service'")
execFileSync(
  bin,
  [entry, '--bundle', '--format=esm', '--outfile=' + join(outDir, 'bundle.js'), '--alias:@=./src'],
  { cwd: root, stdio: 'inherit' },
)
cpSync(join(root, 'scripts', 'verify.ts'), join(outDir, 'verify.mjs'))
console.log('verify bundle written to scripts/dist')
