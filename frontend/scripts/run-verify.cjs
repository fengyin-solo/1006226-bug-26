// 用 esbuild JS API 打包验证脚本后执行，绕开平台原生 bin 的 shebang 问题。
const path = require('path')
const { build } = require('esbuild')
const Module = require('module')

async function main() {
  const result = await build({
    entryPoints: [path.join(__dirname, 'verify-domain.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  })
  const code = result.outputFiles[0].text
  const module = new Module('verify-domain')
  module._compile(code, path.join(__dirname, 'verify-domain.ts'))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
