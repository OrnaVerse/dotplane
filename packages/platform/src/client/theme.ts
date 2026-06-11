import { createTheme, type MantineColorsTuple } from '@mantine/core'

const dark: MantineColorsTuple = [
  '#eaeef2',
  '#c9d1d9',
  '#8b949e',
  '#6e7681',
  '#484f58',
  '#30363d',
  '#21262d',
  '#161b22',
  '#0d1117',
  '#010409',
]

export const STATUS_COLORS = {
  healthy: '#22c55e',
  degraded: '#f59e0b',
  down: '#ef4444',
  unknown: '#6b7280',
  pending: '#3b82f6',
} as const

export type HealthStatus = keyof typeof STATUS_COLORS

export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: 6,
  defaultRadius: 'sm',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  colors: {
    dark,
  },
  headings: {
    fontWeight: '600',
  },
  components: {
    AppShell: {
      styles: {
        main: {
          backgroundColor: dark[8],
        },
        navbar: {
          backgroundColor: dark[7],
          borderColor: dark[5],
        },
        header: {
          backgroundColor: dark[7],
          borderColor: dark[5],
        },
      },
    },
    Card: {
      defaultProps: {
        withBorder: true,
      },
      styles: {
        root: {
          backgroundColor: dark[7],
          borderColor: dark[5],
        },
      },
    },
    Paper: {
      styles: {
        root: {
          backgroundColor: dark[7],
          borderColor: dark[5],
        },
      },
    },
    Table: {
      styles: {
        table: {
          backgroundColor: dark[7],
        },
      },
    },
  },
})
