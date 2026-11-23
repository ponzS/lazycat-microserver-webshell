import { execFileSync } from "node:child_process"
import { copyFileSync, cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const modulePath = "github.com/tetratelabs/wazero"
const version = "v1.10.1"
const patch = fileURLToPath(new URL(`./wazero-${version}-termination.patch`, import.meta.url))
// Patch a private module copy and build with a temporary modfile. The source
// tree and the checksum-verified dependency cache are shared by other builds.
export function runWithCheckpointCompiler(go, args, { cwd, env = process.env } = {}) {
  const options = { cwd, env }
  const inspect = args => execFileSync(go, args, { ...options, encoding: "utf8" }).trim()
  const arch = inspect(["env", "GOARCH"])
  if (arch !== "arm64" && arch !== "amd64") {
    execFileSync(go, args, { ...options, stdio: "inherit" })
    return
  }
  const selected = JSON.parse(inspect(["list", "-mod=readonly", "-m", "-json", modulePath]))
  if (selected.Version !== version || selected.Replace) {
    throw new Error(`Checkpoint compiler patch requires ${modulePath}@${version}`)
  }
  const { Dir: upstream } = JSON.parse(inspect(["mod", "download", "-json", `${modulePath}@${version}`]))
  if (!upstream) throw new Error(`Missing source directory for ${modulePath}@${version}`)
  const temporary = mkdtempSync(join(tmpdir(), "lightos-checkpoint-compiler-"))
  try {
    const dependency = join(temporary, "wazero")
    const modfile = join(temporary, "checkpoint.mod")
    const sourceMod = inspect(["env", "GOMOD"])
    cpSync(upstream, dependency, { recursive: true })
    execFileSync("git", ["apply", "--whitespace=error", patch], { cwd: dependency, stdio: "inherit" })
    copyFileSync(sourceMod, modfile)
    copyFileSync(sourceMod.slice(0, -4) + ".sum", join(temporary, "checkpoint.sum"))
    execFileSync(go, ["mod", "edit", "-modfile", modfile, `-replace=${modulePath}=${dependency}`], options)
    const [command, ...flags] = args
    execFileSync(go, [command, "-modfile", modfile, ...flags], { ...options, stdio: "inherit" })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (!["build", "test", "vet"].includes(args[0])) throw new Error("Use with-checkpoint-compiler.mjs build|test|vet [Go options]")
  runWithCheckpointCompiler("go", args)
}
