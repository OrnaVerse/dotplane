import { execa } from 'execa'

export interface Fail2banJailStatus {
  name: string
  currentlyBanned: number
  totalBanned: number
  bannedIps: string[]
}

export interface Fail2banStatus {
  active: boolean
  jails: Fail2banJailStatus[]
  raw: string
}

export async function getStatus(): Promise<Fail2banStatus> {
  try {
    const { stdout } = await execa('sudo', ['fail2ban-client', 'status'])
    const jailNames = stdout
      .split('\n')
      .find((line) => line.includes('Jail list'))
      ?.split(':')[1]
      ?.split(',')
      .map((name) => name.trim())
      .filter(Boolean) ?? []

    const jails: Fail2banJailStatus[] = []
    for (const name of jailNames) {
      const { stdout: jailOut } = await execa('sudo', ['fail2ban-client', 'status', name])
      jails.push(parseJailStatus(name, jailOut))
    }

    return { active: true, jails, raw: stdout }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { active: false, jails: [], raw: message }
  }
}

export async function unbanIp(jail: string, ip: string): Promise<void> {
  await execa('sudo', ['fail2ban-client', 'set', jail, 'unbanip', ip])
}

function parseJailStatus(name: string, output: string): Fail2banJailStatus {
  const currentlyBanned = parseInt(
    output.match(/Currently banned:\s*(\d+)/)?.[1] ?? '0',
    10
  )
  const totalBanned = parseInt(
    output.match(/Total banned:\s*(\d+)/)?.[1] ?? '0',
    10
  )
  const bannedList = output.match(/Banned IP list:\s*(.*)/)?.[1]?.trim() ?? ''
  const bannedIps = bannedList ? bannedList.split(/\s+/).filter(Boolean) : []

  return { name, currentlyBanned, totalBanned, bannedIps }
}
