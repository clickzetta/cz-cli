const PASSWORD_PATTERN = /(password|passwd|secret|api_key|apikey|token|access_token|refresh_token|private_key)/i
const PHONE_PATTERN = /(phone|mobile|tel|cellphone)/i
const EMAIL_PATTERN = /(email|e_mail)/i
const IDCARD_PATTERN = /(id_card|idcard|id_number|identity|ssn|national_id)/i

function maskPassword(): string {
  return "******"
}

function maskPhone(val: string): string {
  const digits = val.replace(/\D/g, "")
  if (digits.length >= 7) return digits.slice(0, 3) + "****" + digits.slice(-4)
  return "****"
}

function maskEmail(val: string): string {
  const atIdx = val.lastIndexOf("@")
  if (atIdx > 0) {
    const local = val.slice(0, atIdx)
    const domain = val.slice(atIdx + 1)
    return (local.length > 1 ? local[0] + "***" : "***") + "@" + domain
  }
  return "******"
}

function maskIdcard(val: string): string {
  if (val.length >= 6) return val.slice(0, 3) + "*".repeat(Math.max(val.length - 7, 1)) + val.slice(-4)
  return "****"
}

type Masker = (val: string) => string

function getMasker(column: string): Masker | undefined {
  if (PASSWORD_PATTERN.test(column)) return maskPassword
  if (PHONE_PATTERN.test(column)) return maskPhone
  if (EMAIL_PATTERN.test(column)) return maskEmail
  if (IDCARD_PATTERN.test(column)) return maskIdcard
  return undefined
}

export function maskRows(
  columns: string[],
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const maskers = new Map<string, Masker>()
  for (const col of columns) {
    const fn = getMasker(col)
    if (fn) maskers.set(col, fn)
  }

  if (maskers.size === 0) return rows

  return rows.map((row) => {
    const masked = { ...row }
    for (const [col, fn] of maskers) {
      const val = masked[col]
      if (val != null && typeof val === "string") {
        masked[col] = fn(val)
      }
    }
    return masked
  })
}
