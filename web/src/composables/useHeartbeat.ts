import { getCurrentInstance, onUnmounted, type Ref } from 'vue'
import request from '@/utils/request'

/** 心跳上报数据（与后端 HeartbeatDto 约定一致） */
export interface HeartbeatPayload {
  taskId?: number | null
  status: 'typing' | 'paused' | 'finished'
  speed: number
  accuracy: number
  progress: number
  elapsedSeconds: number
  charIndex: number
}

/** 心跳间隔：20 秒 */
const INTERVAL_MS = 20_000

/**
 * 学生端心跳上报：
 * - 每 20 秒 POST /heartbeats 一次，onTick() 可立即触发（首传/测试用）
 * - 发送时刻若页面隐藏/窗口失焦，status 合成为 paused（finished 优先，交卷后不覆盖）
 * - stop() 手动停止；组件内自动在 onUnmounted 清理
 * - 上报失败静默处理，不打断练习
 */
export function useHeartbeat(payload: Ref<HeartbeatPayload>): { stop: () => void; onTick: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false
  let away = false // 窗口失焦（切走应用但未切 tab 时 visibilityState 仍为 visible）

  function send() {
    if (stopped) return
    const base = payload.value
    const hidden = away || document.visibilityState === 'hidden'
    const status = hidden && base.status !== 'finished' ? 'paused' : base.status
    void request
      .post('/heartbeats', { ...base, status })
      .catch(() => {}) // 静默失败
  }

  const onBlur = () => {
    away = true
  }
  const onVisible = () => {
    away = document.visibilityState === 'hidden'
  }
  const onTick = send

  function stop() {
    stopped = true
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onVisible)
    document.removeEventListener('visibilitychange', onVisible)
  }

  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onVisible)
  document.addEventListener('visibilitychange', onVisible)
  timer = setInterval(send, INTERVAL_MS)

  if (getCurrentInstance()) {
    onUnmounted(stop)
  }

  return { stop, onTick }
}
