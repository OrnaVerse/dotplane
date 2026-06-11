import { useCallback, useRef, useState } from 'react'
import { apiPostSse } from '../lib/api'
import type { DeployEvent, DeployStep } from '../lib/types'

const STEP_LABELS: Record<string, string> = {
  download: 'Downloading artifact',
  stop: 'Stopping service',
  deploy: 'Deploying files',
  start: 'Starting service',
  health: 'Health check',
  error: 'Error',
}

function eventToStep(event: DeployEvent): DeployStep | null {
  if (event.type !== 'step' || !event.step || !event.status) return null
  return {
    step: STEP_LABELS[event.step] ?? event.step,
    status: event.status as DeployStep['status'],
    message: event.message,
  }
}

export interface UseDeploymentOptions {
  onComplete?: (success: boolean, deploymentId?: number) => void
}

export function useDeployment(options: UseDeploymentOptions = {}) {
  const [steps, setSteps] = useState<DeployStep[]>([])
  const [running, setRunning] = useState(false)
  const [healthStatus, setHealthStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setSteps([])
    setHealthStatus(null)
    setError(null)
    setRunning(false)
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const deployInstance = useCallback(
    async (instanceId: string, version: string) => {
      reset()
      setRunning(true)
      abortRef.current = new AbortController()

      try {
        await apiPostSse(
          `/instances/${instanceId}/deploy`,
          { version },
          (raw) => {
            const event = raw as DeployEvent

            if (event.type === 'step') {
              const step = eventToStep(event)
              if (step) {
                setSteps((prev) => {
                  const idx = prev.findIndex((s) => s.step === step.step)
                  if (idx >= 0) {
                    const next = [...prev]
                    next[idx] = step
                    return next
                  }
                  return [...prev, step]
                })
              }
            }

            if (event.type === 'health' && event.status) {
              setHealthStatus(event.status)
            }

            if (event.type === 'done') {
              setRunning(false)
              options.onComplete?.(event.success ?? false, event.deploymentId)
            }
          },
          abortRef.current.signal,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Deploy failed'
        setError(message)
        setRunning(false)
        options.onComplete?.(false)
      }
    },
    [reset, options],
  )

  const deployAll = useCallback(
    async (params: {
      appId: string
      version: string
      batchSize?: number
      delaySeconds?: number
      instanceIds?: string[]
    }) => {
      reset()
      setRunning(true)
      abortRef.current = new AbortController()

      try {
        await apiPostSse(
          '/instances/deploy-all',
          {
            batchSize: 3,
            delaySeconds: 30,
            ...params,
          },
          (raw) => {
            const event = raw as DeployEvent & { instanceId?: string }

            if (event.type === 'step' && event.instanceId) {
              const step = eventToStep(event)
              if (step) {
                setSteps((prev) => [
                  ...prev,
                  { ...step, step: `${event.instanceId}: ${step.step}` },
                ])
              }
            }

            if (event.type === 'complete') {
              setRunning(false)
              options.onComplete?.(true)
            }

            if (event.type === 'aborted') {
              setError(event.reason ?? 'Deploy aborted')
              setRunning(false)
              options.onComplete?.(false)
            }
          },
          abortRef.current.signal,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Deploy all failed'
        setError(message)
        setRunning(false)
        options.onComplete?.(false)
      }
    },
    [reset, options],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
  }, [])

  return {
    steps,
    running,
    healthStatus,
    error,
    deployInstance,
    deployAll,
    cancel,
    reset,
  }
}
