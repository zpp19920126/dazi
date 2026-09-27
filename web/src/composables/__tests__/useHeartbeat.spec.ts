import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useHeartbeat, type HeartbeatPayload } from '../useHeartbeat'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))

// mock axios 封装：心跳走 request.post('/heartbeats', body)
vi.mock('@/utils/request', () => ({ default: { post: postMock } }))

function makePayload(overrides: Partial<HeartbeatPayload> = {}): HeartbeatPayload {
  return {
    taskId: 1,
    status: 'typing',
    speed: 0,
    accuracy: 100,
    progress: 0,
    elapsedSeconds: 0,
    charIndex: 0,
    ...overrides,
  }
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
  postMock.mockReset()
  postMock.mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
  setVisibility('visible')
})

describe('useHeartbeat', () => {
  it('每 20 秒自动 POST 一次心跳', () => {
    const payload = ref(makePayload())
    const hb = useHeartbeat(payload)
    vi.advanceTimersByTime(20000)
    vi.advanceTimersByTime(20000)
    expect(postMock).toHaveBeenCalledTimes(2)
    expect(postMock.mock.calls[0][0]).toBe('/heartbeats')
    hb.stop()
  })

  it('stop() 后不再发送', () => {
    const payload = ref(makePayload())
    const hb = useHeartbeat(payload)
    vi.advanceTimersByTime(20000)
    expect(postMock).toHaveBeenCalledTimes(1)
    hb.stop()
    vi.advanceTimersByTime(40000)
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('onTick() 立即发送一次（发送时携带最新 payload 数据）', () => {
    const payload = ref(makePayload({ speed: 66, charIndex: 30 }))
    const hb = useHeartbeat(payload)
    hb.onTick()
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][1]).toMatchObject({ status: 'typing', speed: 66, charIndex: 30 })
    hb.stop()
  })

  it('页面隐藏时发送状态变为 paused；finished 优先不被覆盖', () => {
    setVisibility('hidden')
    const payload = ref(makePayload())
    const hb = useHeartbeat(payload)
    hb.onTick()
    expect(postMock.mock.calls[0][1].status).toBe('paused')

    const finished = ref(makePayload({ status: 'finished' }))
    const hb2 = useHeartbeat(finished)
    hb2.onTick()
    expect(postMock.mock.calls[1][1].status).toBe('finished')
    hb.stop()
    hb2.stop()
  })

  it('组件卸载时自动 stop（onUnmounted 生效）', async () => {
    const { mount } = await import('@vue/test-utils')
    const { defineComponent } = await import('vue')
    const Comp = defineComponent({
      setup() {
        useHeartbeat(ref(makePayload()))
        return () => null
      },
    })
    const wrapper = mount(Comp)
    vi.advanceTimersByTime(20000)
    expect(postMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    vi.advanceTimersByTime(60000)
    expect(postMock).toHaveBeenCalledTimes(1)
  })
})
