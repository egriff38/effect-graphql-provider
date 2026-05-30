// PROTOTYPE — throwaway TUI shell. Drives derive.ts + example.ts by hand.
// Run: bun prototype/main.ts   (or: bun run prototype)

import { graphql, printSchema } from "graphql"
import { deriveSchema } from "./derive.ts"
import { presetQueries, resetTrace, roots, trace } from "./example.ts"

const schema = deriveSchema(roots)
const sdl = printSchema(schema).trim()

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const out = (s: string) => process.stdout.write(s)
const line = (s = "") => out(s + "\n")

interface Run {
  label: string
  query: string
  trace: string[]
  result: string
}
let last: Run | undefined

function render() {
  out("\x1b[2J\x1b[H")
  line(bold("effect-graphql-provider — PROTOTYPE") + dim("   every field = Rpc.make; types discovered by crawling roots"))
  line()
  line(bold("Derived GraphQL SDL") + dim("   ← crawled from the root rpcs; nothing hand-written"))
  for (const l of sdl.split("\n")) line(dim("  " + l))
  line()
  line(bold("Queries"))
  presetQueries.forEach((q, i) => line(`  ${bold(String(i + 1))}  ${dim(q.label)}`))
  line()
  if (last) {
    line(bold("Last run") + dim("   " + last.label))
    line(dim("  " + last.query))
    line()
    line(bold("  Resolution trace") + dim("   (firing order; source = the parent passed to each resolver)"))
    if (last.trace.length === 0) line(dim("    (no resolvers fired — plain fields use graphql-js default resolver)"))
    else for (const t of last.trace) line("    " + t)
    line()
    line(bold("  Result"))
    for (const l of last.result.split("\n")) line(dim("    " + l))
  } else {
    line(dim("Press 1-4 to run a query and watch which resolvers fire."))
  }
  line()
  line(dim("[1-" + presetQueries.length + "] run query    [q] quit"))
}

async function run(i: number) {
  const preset = presetQueries[i]
  resetTrace()
  const result = await graphql({ schema, source: preset.query })
  last = { label: preset.label, query: preset.query, trace: [...trace], result: JSON.stringify(result, null, 2) }
  render()
}

function main() {
  render()
  const stdin = process.stdin
  if (stdin.isTTY) stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding("utf8")
  stdin.on("data", (key: string) => {
    if (key === "q" || key === "\u0003") {
      out("\x1b[2J\x1b[H")
      process.exit(0)
    }
    const n = Number(key)
    if (Number.isInteger(n) && n >= 1 && n <= presetQueries.length) void run(n - 1)
  })
}

main()
