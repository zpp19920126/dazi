import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * 内置文章（createdBy = null 表示全局内置，所有角色可见）。
 * charCount 按 Unicode 码点计算（[...content].length），中文一个汉字、emoji 均计为 1。
 */
const builtinTexts: { title: string; language: 'zh' | 'en'; difficulty: number; content: string }[] = [
  {
    title: '我的学校生活',
    language: 'zh',
    difficulty: 2,
    content:
      '我的学校生活丰富多彩。每天清晨，我背着书包走进校园，先在操场上做早操，然后开始一天的课程。语文课上，老师带我们朗读优美的课文；数学课上，我们挑战一道道有趣的题目；英语课上，大家跟着录音大声对话。中午，我和同学们一起在食堂吃饭，说说笑笑，胃口特别好。下午的活动课是我最喜欢的时光，有的同学踢足球，有的同学画画，我则喜欢在图书角安静地看书。放学后，我常常和好朋友一起复习功课，互相帮助。学校不仅教给我知识，还让我收获了珍贵的友谊。我爱我的学校，也爱这段快乐的学校生活。',
  },
  {
    title: '秋天的公园',
    language: 'zh',
    difficulty: 3,
    content:
      '秋天到了，公园换上了金黄的新装。星期天的早晨，我和爸爸妈妈一起去公园散步。一进大门，一阵清凉的风迎面吹来，空气里飘着淡淡的桂花香。道路两旁的银杏树叶子全黄了，一阵风吹过，叶子像一只只黄蝴蝶打着旋儿飘落下来，给小路铺上了一层金色的地毯。湖边的菊花开了，红的、黄的、白的、紫的，五颜六色，美丽极了。湖水清澈见底，几只鸭子在水面上悠闲地游来游去，不时把头扎进水里觅食。远处，几位老爷爷在凉亭里下棋、聊天，孩子们在草地上放风筝，笑声传得很远很远。秋天虽然没有春天的生机勃勃，却有着成熟的美丽与丰收的喜悦。我爱秋天，更爱秋天的公园。',
  },
  {
    title: '我最喜欢的节日',
    language: 'zh',
    difficulty: 5,
    content:
      '一年之中有许多节日，我最喜欢的要数春节了。春节是中华民族最隆重的传统节日，每到腊月，家家户户就开始忙碌起来：扫尘、贴春联、买年货，到处洋溢着喜庆的气氛。除夕晚上，全家人围坐在一起吃年夜饭，桌上有红烧鱼、白切鸡，还有我最爱吃的水饺。吃过饭，我们一起看春节联欢晚会，精彩的节目逗得大家哈哈大笑。到了午夜十二点，窗外的烟花腾空而起，把夜空装点得五彩缤纷。大年初一，我穿上新衣服，跟着爸爸妈妈去给长辈拜年，还能收到压岁钱。奶奶说，压岁钱寄托着长辈对晚辈的美好祝福。春节让我感受到了团圆的幸福和传统文化的魅力，所以我最喜欢这个节日。',
  },
  {
    title: 'My School Day',
    language: 'en',
    difficulty: 1,
    content:
      "My name is Tom. I am a student of Sunshine Middle School. Every morning, I get up at six thirty and have breakfast with my family. Then I ride my bike to school. Classes begin at eight o'clock. I have four lessons in the morning and two in the afternoon. My favorite subject is English, because I can learn about the world and make friends with children from other countries. At noon, I have lunch in the school dining hall with my best friends. The food there is nice and cheap. After school, I often play basketball on the playground with my classmates. It makes me strong and happy. In the evening, I do my homework first, and then I read storybooks or watch the news with my parents. I usually go to bed at ten o'clock. My school day is busy but interesting. I love my school life very much.",
  },
  {
    title: 'A Trip to the Zoo',
    language: 'en',
    difficulty: 3,
    content:
      "Last Saturday, our class went to the city zoo for an outing. The weather was sunny and warm, so everyone was in a good mood. First, we visited the panda house. The pandas were eating bamboo and rolling on the grass. They were so cute that nobody wanted to leave. Then we watched the monkeys jumping from tree to tree. After that, we saw lions, tigers, elephants and giraffes. The giraffes had long necks and ate leaves from the tall trees. At noon, we had a picnic on the grass near the lake. In the afternoon, we watched an animal show. The dolphins jumped through rings and played with balls. We got back to school at four o'clock. Although I was tired, I felt very happy. It was an unforgettable trip, and I hope to visit the zoo again soon.",
  },
  {
    title: 'My Best Friend',
    language: 'en',
    difficulty: 4,
    content:
      "My best friend is Li Hua. We have known each other since primary school, and now we are classmates. Li Hua is a tall boy with short black hair and a pair of bright eyes. He always has a smile on his face. He is good at math and often helps me with my homework. When I have difficulties in my studies, he is always patient and explains everything again and again until I understand. Besides studying, we both love playing football. Every weekend, we play football together in the park near our homes. Sometimes we lose a game, but we never blame each other, because friendship is more important than winning. Last month, he helped an old woman who fell down on the street. I feel lucky to have such a friend. I hope our friendship will last forever.",
  },
];

async function main() {
  // 1. 超管账号（幂等：已存在则保留现状，不覆盖密码与改密标记）
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash,
      realName: '系统管理员',
      role: 'admin',
      status: 'active',
      mustChangePassword: true,
    },
  });

  // 2. 内置文章（幂等：先清空内置文章再重建；教师自建文章 createdBy 非空，不受影响）
  await prisma.text.deleteMany({ where: { createdBy: null } });
  await prisma.text.createMany({
    data: builtinTexts.map((t) => ({
      title: t.title,
      language: t.language,
      difficulty: t.difficulty,
      content: t.content,
      charCount: [...t.content].length,
      createdBy: null,
      status: 'published',
    })),
  });

  console.log('Seed 完成：超管 admin/admin123 + 内置文章 %d 篇', builtinTexts.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
