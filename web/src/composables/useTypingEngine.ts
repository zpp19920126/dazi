import { getCurrentInstance, onUnmounted, ref, type Ref } from 'vue';

export interface TypingEngineOptions {
  target: Ref<string>; // 练习文本
  mode: 'article' | 'time';
  durationSeconds?: number; // time 模式
  onTimeout?: () => void;
}

export interface TypingStats {
  charIndex: number; // 已提交输入长度
  correctChars: number; // 与 target 比对正确的字符数
  accuracy: number; // correctChars / charIndex * 100，除零为 100
  speed: number; // correctChars / (elapsedMs/60000)，中英文同口径
  elapsedMs: number; // 从第一个有效按键起计时（time 模式从引擎创建起）
  backspaceCount: number;
  progress: number; // article: charIndex/target.length*100；time: 已用时占比
  finished: boolean; // article 打满 或 time 倒计时归零
}

const TICK_MS = 100;

/**
 * 打字引擎：中英文统一统计口径。
 * 英文走 handleKeydown（单字符 key 直输），中文走 handleCompositionEnd（系统输入法
 * 或自定义候选条上屏后调用；纯 ASCII 的 data 视为拼音过程，不计入）。
 */
export function useTypingEngine(opts: TypingEngineOptions) {
  const typed = ref('');
  let finishedInternal = false;
  let startedAt = 0; // article: 首个有效输入时刻；time: 引擎创建时刻
  let timer: ReturnType<typeof setInterval> | null = null;

  const stats = ref<TypingStats>({
    charIndex: 0,
    correctChars: 0,
    accuracy: 100,
    speed: 0,
    elapsedMs: 0,
    backspaceCount: 0,
    progress: 0,
    finished: false,
  });

  function elapsedNow(): number {
    return startedAt > 0 ? Date.now() - startedAt : 0;
  }

  function recompute() {
    const target = opts.target.value;
    const t = typed.value;
    let correct = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === target[i]) correct++;
    }
    const elapsedMs = opts.mode === 'time' ? elapsedNow() : elapsedNow();
    const duration = opts.durationSeconds ?? 0;
    stats.value = {
      charIndex: t.length,
      correctChars: correct,
      accuracy: t.length ? Number(((correct / t.length) * 100).toFixed(2)) : 100,
      speed: elapsedMs > 0 ? Number(((correct / (elapsedMs / 60000))).toFixed(2)) : 0,
      elapsedMs,
      backspaceCount: stats.value.backspaceCount,
      progress:
        opts.mode === 'article'
          ? target.length
            ? Math.min(100, (t.length / target.length) * 100)
            : 0
          : duration > 0
            ? Math.min(100, (elapsedMs / (duration * 1000)) * 100)
            : 0,
      finished: stats.value.finished,
    };
  }

  function finish() {
    if (finishedInternal) return;
    finishedInternal = true;
    stats.value = { ...stats.value, finished: true };
    stopTick();
  }

  function startTick() {
    if (timer !== null) return;
    timer = setInterval(() => {
      if (opts.mode === 'time') {
        const duration = opts.durationSeconds ?? 0;
        const elapsed = Date.now() - startedAt;
        if (elapsed >= duration * 1000) {
          stats.value = { ...stats.value, elapsedMs: duration * 1000 };
          recompute();
          finish();
          opts.onTimeout?.();
        } else {
          recompute();
        }
      } else {
        recompute();
      }
    }, TICK_MS);
  }

  function stopTick() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function begin() {
    if (opts.mode === 'article' && startedAt === 0) startedAt = Date.now();
    startTick();
  }

  function handleKeydown(e: KeyboardEvent) {
    // IME 拼音期间的 keydown（Chrome keyCode 229 / isComposing / Process）不计入
    if (finishedInternal || e.isComposing || e.key === 'Process' || e.keyCode === 229) return;
    if (e.key === 'Backspace') {
      if (!typed.value) return;
      typed.value = typed.value.slice(0, -1);
      stats.value = { ...stats.value, backspaceCount: stats.value.backspaceCount + 1 };
      recompute();
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (opts.mode === 'article' && typed.value.length >= opts.target.value.length) return;
    begin();
    typed.value += e.key;
    recompute();
    if (opts.mode === 'article' && typed.value.length >= opts.target.value.length) finish();
  }

  function handleCompositionEnd(e: CompositionEvent) {
    if (finishedInternal) return;
    const data = e.data ?? '';
    // 纯 ASCII（拼音过程/英文联想）不计入，仅上屏包含中文等非 ASCII 字符的内容
    if (!data || !/[^\x00-\x7F]/.test(data)) return;
    begin();
    typed.value += data;
    recompute();
  }

  function reset() {
    stopTick();
    typed.value = '';
    finishedInternal = false;
    startedAt = opts.mode === 'time' ? Date.now() : 0;
    stats.value = {
      charIndex: 0,
      correctChars: 0,
      accuracy: 100,
      speed: 0,
      elapsedMs: 0,
      backspaceCount: 0,
      progress: 0,
      finished: false,
    };
    if (opts.mode === 'time') startTick();
  }

  // time 模式从引擎创建即开始倒计时
  if (opts.mode === 'time') {
    startedAt = Date.now();
    startTick();
  }

  if (getCurrentInstance()) {
    onUnmounted(stopTick);
  }

  return { stats, handleCompositionEnd, handleKeydown, reset };
}
