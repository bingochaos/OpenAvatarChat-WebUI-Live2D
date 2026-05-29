import micromatch from 'micromatch'

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/dist-electron/**',
  '**/out/**',
  '**/build/**',
  '**/.husky/**',
  '**/public/**',
  'resources/**',
  'scripts/**',
  '**/*.min.js',
  '**/*.min.mjs',
  '**/*.min.cjs',
  '**/*.bundle.js',
  '**/vendor/**',
  '**/third_party/**',
  '**/third-party/**',
  'pnpm-lock.yaml',
]

const LINT_EXTENSIONS = '**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts,vue}'
const FORMAT_EXTENSIONS = '**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts,vue,json,md,less,css,html,yml,yaml}'

const filter = (files, pattern) =>
  micromatch(files, [pattern, ...IGNORE_PATTERNS.map((p) => `!${p}`)], { dot: true })

export default {
  '*': (allFiles) => {
    const commands = []

    const lintFiles = filter(allFiles, LINT_EXTENSIONS)
    if (lintFiles.length > 0) {
      commands.push(
        `eslint --fix --cache --cache-location node_modules/.cache/eslint/ ${lintFiles
          .map((f) => JSON.stringify(f))
          .join(' ')}`
      )
    }

    const formatFiles = filter(allFiles, FORMAT_EXTENSIONS)
    if (formatFiles.length > 0) {
      commands.push(
        `prettier --write --ignore-unknown ${formatFiles.map((f) => JSON.stringify(f)).join(' ')}`
      )
    }

    return commands
  },
}
