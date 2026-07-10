import { createInterface } from "node:readline"

export async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${message} [y/N] `, resolve)
    })
    return answer.trim().toLowerCase() === "y"
  } finally {
    rl.close()
  }
}
