import { execa } from 'execa'

export interface FirewallRule {
  number: number
  action: string
  from: string
  to: string
  protocol: string
  port: string
}

export interface FirewallStatus {
  active: boolean
  defaultIncoming: string
  defaultOutgoing: string
  rules: FirewallRule[]
  raw: string
}

export async function getStatus(): Promise<FirewallStatus> {
  const { stdout } = await execa('sudo', ['ufw', 'status', 'numbered'])
  return parseUfwStatus(stdout)
}

export async function allowRule(params: {
  port: number
  protocol?: 'tcp' | 'udp'
  from?: string
}): Promise<void> {
  const { port, protocol = 'tcp', from } = params
  const args = ['ufw', 'allow']

  if (from) {
    args.push('from', from, 'to', 'any', 'port', String(port), 'proto', protocol)
  } else {
    args.push(`${port}/${protocol}`)
  }

  await execa('sudo', args)
}

export async function deleteRule(ruleNumber: number): Promise<void> {
  await execa('sudo', ['ufw', '--force', 'delete', String(ruleNumber)])
}

function parseUfwStatus(output: string): FirewallStatus {
  const lines = output.split('\n')
  const active = lines.some((line) => line.includes('Status: active'))
  const defaultIncoming = lines.find((line) => line.startsWith('Default:'))?.match(/deny \(incoming\)|allow \(incoming\)|reject \(incoming\)/)?.[0] ?? 'unknown'
  const defaultOutgoing = lines.find((line) => line.startsWith('Default:'))?.match(/deny \(outgoing\)|allow \(outgoing\)|reject \(outgoing\)/)?.[0] ?? 'unknown'

  const rules: FirewallRule[] = []
  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s+(\S+)\s+(.*)$/)
    if (!match) continue

    const [, num, action, rest] = match
    const parts = rest?.trim().split(/\s+/) ?? []
    rules.push({
      number: parseInt(num ?? '0', 10),
      action: action ?? '',
      from: parts[0] ?? '',
      to: parts[2] ?? '',
      protocol: parts.includes('proto') ? (parts[parts.indexOf('proto') + 1] ?? '') : '',
      port: parts.includes('port') ? (parts[parts.indexOf('port') + 1] ?? '') : '',
    })
  }

  return {
    active,
    defaultIncoming,
    defaultOutgoing,
    rules,
    raw: output,
  }
}
