#!/usr/bin/env node
// Генератор порталу презентацій.
// Читає список опублікованих прев'ю (папки в PREVIEWS_DIR) ∩ метадані з presentations.json
// і вставляє згенеровані секції з картками у index.template.html.
//
// Використання:
//   node build.mjs [--previews <dir>] [--out <file>] [--template <file>] [--manifest <file>]
// Дефолти:
//   --previews  ./previews          (у корені gh-pages)
//   --out       ./index.html
//   --template  <script>/index.template.html
//   --manifest  <script>/presentations.json

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PREVIEWS_DIR = resolve(arg('previews', process.env.PREVIEWS_DIR || 'previews'));
const OUT = resolve(arg('out', process.env.OUT || 'index.html'));
const TEMPLATE = resolve(arg('template', join(__dirname, 'index.template.html')));
const MANIFEST = resolve(arg('manifest', join(__dirname, 'presentations.json')));

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Назва за замовчуванням, коли прев'ю нема в маніфесті: "feature-l3" -> "L3"
function slugToTitle(slug) {
  const cleaned = slug.replace(/^feature[-_]/i, '').replace(/[-_]+/g, ' ').trim();
  return cleaned.replace(/\b([a-z])/g, (m) => m.toUpperCase()) || slug;
}

function listPreviews(dir) {
  if (!existsSync(dir)) {
    console.warn(`⚠️  Папку прев'ю не знайдено: ${dir} — генерую портал без карток.`);
    return [];
  }
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isDirectory())
    .sort();
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const template = readFileSync(TEMPLATE, 'utf8');
const availableSlugs = listPreviews(PREVIEWS_DIR);
const available = new Set(availableSlugs);

const bySlug = new Map((manifest.presentations || []).map((p) => [p.slug, p]));

// Групи з маніфесту; 'other' — резервна для прев'ю без метаданих.
const groups = (manifest.groups || []).map((g) => ({ ...g, items: [] }));
const groupMap = new Map(groups.map((g) => [g.id, g]));
if (!groupMap.has('other')) {
  const other = { id: 'other', title: 'Інші презентації', title_en: 'Other presentations', items: [] };
  groups.push(other);
  groupMap.set('other', other);
}

let published = 0;
for (const slug of availableSlugs) {
  const meta = bySlug.get(slug);
  const groupId = meta && groupMap.has(meta.group) ? meta.group : 'other';
  const card = meta
    ? {
        slug,
        order: meta.order ?? 999,
        badge: meta.badge || '',
        badge_en: meta.badge_en || meta.badge || '',
        title: meta.title || slugToTitle(slug),
        title_en: meta.title_en || meta.title || slugToTitle(slug),
        desc: meta.desc || '',
        desc_en: meta.desc_en || meta.desc || '',
      }
    : {
        slug,
        order: 1000,
        badge: '',
        badge_en: '',
        title: slugToTitle(slug),
        title_en: slugToTitle(slug),
        desc: '',
        desc_en: '',
      };
  groupMap.get(groupId).items.push(card);
  published++;
}

// Попередження про метадані без опублікованого прев'ю (напр. гілку ще не задеплоєно).
for (const p of manifest.presentations || []) {
  if (!available.has(p.slug)) {
    console.warn(`ℹ️  У маніфесті є '${p.slug}', але прев'ю ще не опубліковано — картку пропущено.`);
  }
}

function renderCard(c) {
  const badge = c.badge
    ? `\n              <span class="badge num" data-ua="${esc(c.badge)}" data-en="${esc(c.badge_en)}">${esc(c.badge)}</span>`
    : '';
  const desc = c.desc
    ? `\n            <p data-ua="${esc(c.desc)}" data-en="${esc(c.desc_en)}">${esc(c.desc)}</p>`
    : '';
  return `        <li>
          <a class="card" href="previews/${esc(c.slug)}/">
            <div class="card-head">
              <h3 data-ua="${esc(c.title)}" data-en="${esc(c.title_en)}">${esc(c.title)}</h3>${badge}
            </div>${desc}
            <span class="arrow" aria-hidden="true">→</span>
          </a>
        </li>`;
}

function renderSection(g) {
  const cards = g.items
    .slice()
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'uk'))
    .map(renderCard)
    .join('\n');
  return `      <section>
        <h2 class="section-title" data-ua="${esc(g.title)}" data-en="${esc(g.title_en || g.title)}">${esc(g.title)}</h2>
        <ul class="cards">
${cards}
        </ul>
      </section>`;
}

const sections = groups
  .filter((g) => g.items.length > 0)
  .map(renderSection)
  .join('\n\n');

if (!template.includes('<!--SECTIONS-->')) {
  console.error('❌ У шаблоні відсутній маркер <!--SECTIONS-->');
  process.exit(1);
}

const html = template.replace('<!--SECTIONS-->', sections || '');
writeFileSync(OUT, html);
console.log(`✅ Згенеровано ${OUT} — ${published} презентацій у ${groups.filter((g) => g.items.length).length} групах.`);
