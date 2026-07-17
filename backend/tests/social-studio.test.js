// v5 Prompt 10 — Social Studio: channel-aware schema (slides for carousels,
// video_script for reels), and calendar grouping / planned-date persistence.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const { socialCaptionSchema } = require('../lib/schemas');

const calUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'social-calendar.js')).href;

const itemProps = socialCaptionSchema.properties.items.items.properties;

test('schema carries per-format fields, not a single flat caption shape', () => {
  assert.ok(itemProps.slides, 'slides missing');
  assert.ok(itemProps.video_script, 'video_script missing');
  assert.ok(itemProps.pillar, 'pillar missing');
});

test('carousel slides are slide-by-slide with heading/body/visual', () => {
  const slide = socialCaptionSchema.properties.items.items.properties.slides.items;
  for (const f of ['slide_number', 'heading', 'body', 'visual']) {
    assert.ok(slide.required.includes(f), `slide missing ${f}`);
  }
});

test('video_script has hook, spoken script, on-screen text, shot list, b-roll and cta', () => {
  const vs = itemProps.video_script;
  for (const f of ['hook', 'spoken_script', 'on_screen_text', 'shot_list', 'b_roll', 'cta']) {
    assert.ok(vs.required.includes(f), `video_script missing ${f}`);
  }
});

test('content types include carousel, reel/short video and pin/post', () => {
  const types = itemProps.content_type.enum;
  for (const t of ['carousel', 'reel', 'short_video', 'pin', 'post', 'story', 'caption']) {
    assert.ok(types.includes(t), `missing content_type ${t}`);
  }
});

test('planned_date validation accepts only YYYY-MM-DD', async () => {
  const { isValidPlannedDate } = await import(calUrl);
  assert.equal(isValidPlannedDate('2026-08-01'), true);
  assert.equal(isValidPlannedDate('2026-8-1'), false);
  assert.equal(isValidPlannedDate('tomorrow'), false);
  assert.equal(isValidPlannedDate(null), false);
});

test('calendar groups items by planned date and keeps unscheduled separate', async () => {
  const { groupByPlannedDate } = await import(calUrl);
  const { days, unscheduled } = groupByPlannedDate([
    { id: 1, planned_date: '2026-08-05', hook: 'b' },
    { id: 2, planned_date: '2026-08-01', hook: 'a' },
    { id: 3, planned_date: null, hook: 'c' },
    { id: 4, planned_date: '2026-08-01', hook: 'a2' },
  ]);
  assert.deepEqual(days.map((d) => d.date), ['2026-08-01', '2026-08-05']); // date-sorted
  assert.equal(days[0].items.length, 2);
  assert.equal(unscheduled.length, 1);
  assert.equal(unscheduled[0].id, 3);
});
