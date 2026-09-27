import { randomInt } from 'node:crypto';

// 四类字符集（剔除易混淆的 0/O、1/l/I）
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!@#$%^&*';
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

/** 生成 8 位初始密码：大小写字母/数字/符号至少各一，Fisher-Yates 洗牌打散类别位置 */
export function generatePassword(length = 8): string {
  const chars = [LOWER, UPPER, DIGIT, SYMBOL].map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(ALL[randomInt(ALL.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
