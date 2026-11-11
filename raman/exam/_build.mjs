// 生成考场速查数据：扫描 raman/*/第N课_*.html + 课后作业解答，输出 data.js
// 用法： node _build.mjs
import fs from 'node:fs';
import path from 'node:path';

const RAMAN = 'D:/GitHub/smokeszw_record/raman';
const OUT_DIR = path.join(RAMAN, 'exam');
const SOL_JSON = 'D:/MyProjects/raman_exam/solutions.json';

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

const clean = (s) => decode(s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ''))
  .replace(/[ \t\u00a0]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n')
  .trim();

const readUtf8 = (p) => fs.readFileSync(p, 'utf8');

const lessons = [];
const dirs = fs.readdirSync(RAMAN)
  .filter((d) => /^rm_lesson\d+$/.test(d))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

for (const d of dirs) {
  const no = parseInt(d.match(/\d+/)[0]);
  const dirPath = path.join(RAMAN, d);
  const htmlFile = fs.readdirSync(dirPath).find((f) => f.endsWith('.html'));
  if (!htmlFile) continue;
  const html = readUtf8(path.join(dirPath, htmlFile));

  const title = clean((html.match(/<title>([\s\S]*?)<\/title>/) || [, htmlFile])[1]);
  const brand = clean((html.match(/<h1>([\s\S]*?)<\/h1>/) || [, title])[1]);
  const sub = clean((html.match(/<div class="sub">([\s\S]*?)<\/div>/) || [, ''])[1]);
  const short = htmlFile.replace(/_课件与讲述对照\.html$/, '').replace(/\.html$/, '');
  const url = `../${d}/${encodeURIComponent(htmlFile)}`.replace(/%2F/g, '/');

  const sections = [];
  const secRe = /<section class="sec" id="([^"]+)">([\s\S]*?)<\/section>/g;
  let m;
  while ((m = secRe.exec(html))) {
    const id = m[1];
    const chunk = m[2];
    const secNo = clean((chunk.match(/<span class="sec-no">([\s\S]*?)<\/span>/) || [, ''])[1]);
    const secTitle = clean((chunk.match(/<h2>([\s\S]*?)<\/h2>/) || [, ''])[1]);
    const chips = [...chunk.matchAll(/<span class="chip">([\s\S]*?)<\/span>/g)].map((x) => clean(x[1]));
    const slides = [];
    const slideRe = /<figure class="slide" id="slide-(\d+)">\s*<img src="([^"]+)" alt="([\s\S]*?)"\s*\/?>[\s\S]*?<span class="sno">([^<]*)<\/span>\s*<span class="stitle">([\s\S]*?)<\/span>/g;
    let sm;
    while ((sm = slideRe.exec(chunk))) {
      slides.push({
        id: parseInt(sm[1], 10),
        src: `../${d}/${decode(sm[2])}`,
        alt: clean(sm[3]),
        no: clean(sm[4]),
        title: clean(sm[5]),
      });
    }
    const bodyIdx = chunk.indexOf('<div class="sec-body">');
    const body = bodyIdx >= 0 ? clean(chunk.slice(bodyIdx + '<div class="sec-body">'.length)) : '';
    sections.push({ id, no: secNo, title: secTitle, chips, body, slides });
  }

  lessons.push({
    no, dir: d, file: htmlFile, short, title: brand, sub, url,
    slideCount: sections.reduce((a, s) => a + s.slides.length, 0),
    sections,
  });
}

// ---------- 作业条目（习题课里按“作业N”整理，对应章由所在习题课覆盖范围决定） ----------
const hw = [];
const CHAPTER_RANGE = new Map([[10, [1, 3]], [17, [4, 6]]]);
for (const L of lessons) {
  const range = CHAPTER_RANGE.get(L.no);
  let chapter = range ? range[0] : null;
  for (const s of L.sections) {
    const chm = s.title.match(/^第\s*(\d)\s*章/);
    if (chm) chapter = parseInt(chm[1], 10);
    const hm = s.title.match(/^作业\s*(\d+)/);
    if (hm && chapter) {
      hw.push({
        t: 'H',
        chapter,
        hwNo: parseInt(hm[1], 10),
        title: s.title,
        lessonNo: L.no,
        lessonShort: L.short,
        secId: s.id,
        secNo: s.no,
        body: s.body,
        slides: s.slides,
        url: L.url,
      });
    }
  }
}

// ---------- 课后作业解答 ----------
const sols = [];
if (fs.existsSync(SOL_JSON)) {
  const raw = JSON.parse(readUtf8(SOL_JSON).replace(/^\uFEFF/, ''));
  for (const [file, paras] of Object.entries(raw)) {
    const chm = file.match(/第([一二三四五六])章/);
    const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const chapter = chm ? CN[chm[1]] : null;
    // 合并过短的段落，每块 300~700 字
    let buf = [], len = 0;
    const flush = () => { if (buf.length) { sols.push({ t: 'S', chapter, file, text: buf.join('\n') }); buf = []; len = 0; } };
    for (const p of paras) {
      buf.push(p); len += p.length;
      if (len >= 420) flush();
    }
    flush();
  }
}

const data = {
  generated: new Date().toISOString(),
  lessons: lessons.map((L) => ({
    no: L.no, short: L.short, title: L.title, sub: L.sub, url: L.url,
    slideCount: L.slideCount,
    sections: L.sections.map((s) => ({
      id: s.id, no: s.no, title: s.title, chips: s.chips, body: s.body,
      slides: s.slides,
    })),
  })),
  hw,
  sols,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const js = 'window.EXAM_DATA=' + JSON.stringify(data) + ';\n';
fs.writeFileSync(path.join(OUT_DIR, 'data.js'), js, 'utf8');

const bytes = Buffer.byteLength(js, 'utf8');
const secTotal = lessons.reduce((a, L) => a + L.sections.length, 0);
const slideTotal = lessons.reduce((a, L) => a + L.slideCount, 0);
console.log(`lessons=${lessons.length} sections=${secTotal} slides=${slideTotal} hw=${hw.length} sols=${sols.length} data.js=${(bytes / 1024).toFixed(0)}KB`);
