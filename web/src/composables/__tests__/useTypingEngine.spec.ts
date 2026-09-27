import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useTypingEngine } from '../useTypingEngine';

function setup(target: string, mode: 'article' | 'time' = 'article', duration = 60) {
  const onTimeout = vi.fn();
  const engine = useTypingEngine({ target: ref(target), mode, durationSeconds: duration, onTimeout });
  return { ...engine, onTimeout };
}

describe('useTypingEngine', () => {
  it('英文逐字输入统计正确数与速度', () => {
    vi.useFakeTimers();
    const e = setup('hello');
    const t0 = Date.now();
    vi.setSystemTime(t0 + 1000);
    for (const ch of 'hello') {
      e.handleKeydown(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      vi.setSystemTime(Date.now() + 1000);
    }
    expect(e.stats.value.charIndex).toBe(5);
    expect(e.stats.value.correctChars).toBe(5);
    expect(e.stats.value.speed).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('错字符计入 charIndex 但不计入 correctChars，准确率下降', () => {
    const e = setup('abc');
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'a' }));
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'x' }));
    expect(e.stats.value.correctChars).toBe(1);
    expect(e.stats.value.accuracy).toBeCloseTo(50);
  });

  it('退格回退 charIndex 并计数', () => {
    const e = setup('abc');
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'a' }));
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(e.stats.value.charIndex).toBe(0);
    expect(e.stats.value.backspaceCount).toBe(1);
  });

  it('composition 上屏的中文整体计入，拼音过程不计', () => {
    const e = setup('你好');
    e.handleCompositionEnd(new CompositionEvent('compositionend', { data: 'ni' }));
    expect(e.stats.value.charIndex).toBe(0); // 直接 compositionend 前无中文
    e.handleCompositionEnd(new CompositionEvent('compositionend', { data: '你好' }));
    expect(e.stats.value.charIndex).toBe(2);
    expect(e.stats.value.correctChars).toBe(2);
  });

  it('time 模式倒计时归零触发 onTimeout 且 finished=true', () => {
    vi.useFakeTimers();
    const e = setup('abc', 'time', 2);
    vi.advanceTimersByTime(2001);
    expect(e.stats.value.finished).toBe(true);
    expect(e.onTimeout).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('article 模式打满自动 finished', () => {
    const e = setup('ab');
    for (const ch of 'ab') e.handleKeydown(new KeyboardEvent('keydown', { key: ch }));
    expect(e.stats.value.finished).toBe(true);
    expect(e.stats.value.progress).toBe(100);
  });
});
