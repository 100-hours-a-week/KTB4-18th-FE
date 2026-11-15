import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const origin = `http://127.0.0.1:${process.env.MUSIC_RECORD_TRANSITION_PORT ?? '5181'}`;
const suite = process.argv[2];
const backName = '음악 기록 목록으로 돌아가기';
const token =
  'e30.' +
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url') +
  '.fixture';
const album = (id, title, color) => ({
  record_id: id,
  music: {
    music_id: id,
    title,
    artist_name: 'Fixture Artist',
    album_cover_url: color ? '/transition-fixture-' + color + '.svg' : null,
  },
  map_dot_id: id,
  region: {
    sido: { region_id: 1, code: '11', name: '서울특별시' },
    sigungu: { region_id: 1, code: '11001', name: '동네' },
  },
  custom_place_name: 'Fixture Place',
  emotion_memo: null,
  created_at: '2026-11-09T08:00:00Z',
  updated_at: null,
});
const records = [
  album(1, 'First fixture', 'orange'),
  album(2, 'Second fixture with a long title that wraps onto another line', 'purple'),
  album(3, 'Coverless fixture', null),
];
async function setup(browser, config) {
  const page = await browser.newPage({
    viewport: { width: config.width ?? 390, height: config.height ?? 800 },
    reducedMotion: config.reducedMotion ?? 'no-preference',
  });
  const errors = [];
  let isReturning = false;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ token, noApi }) => {
      sessionStorage.setItem('access_token', token);
      sessionStorage.setItem('access_token_epoch', '0');
      window.transitionEvents = [];
      if (noApi) {
        Object.defineProperty(document, 'startViewTransition', { value: undefined });
        return;
      }
      const native = document.startViewTransition.bind(document);
      document.startViewTransition = (callback) => {
        const source = document.querySelector('[data-music-record-transition-card]');
        const sourceBounds = source?.getBoundingClientRect();
        window.transitionEvents.push({
          event: 'started',
          scroll: scrollY,
          sourceSize: [sourceBounds?.width, sourceBounds?.height],
        });
        const transition = native(callback);
        transition.ready.then(
          () => {
            const root = document.documentElement;
            const active = document.querySelector('[data-music-record-transition-card]');
            const targetBounds = active?.getBoundingClientRect();
            const blur = active?.querySelector('[data-music-record-part="background"] img');
            const parts = ['background', 'artwork', 'title', 'artist'].map((part) => {
              const name = 'music-record-' + part;
              const group = getComputedStyle(root, '::view-transition-group(' + name + ')');
              const old = getComputedStyle(root, '::view-transition-old(' + name + ')');
              const next = getComputedStyle(root, '::view-transition-new(' + name + ')');
              const animation = document
                .getAnimations()
                .find((animation) => animation.animationName === group.animationName);
              const geometry = () => ({
                transform: group.transform,
                size: [parseFloat(group.width), parseFloat(group.height)],
              });
              let start;
              let end;
              if (animation) {
                const currentTime = animation.currentTime;
                animation.currentTime = 0;
                start = geometry();
                animation.currentTime = animation.effect.getComputedTiming().endTime;
                end = geometry();
                animation.currentTime = currentTime;
              }
              return {
                part,
                animation: group.animationName,
                duration: group.animationDuration,
                zIndex: Number(group.zIndex),
                oldAnimation: old.animationName,
                newAnimation: next.animationName,
                oldOpacity: old.opacity,
                newOpacity: next.opacity,
                newObjectFit: next.objectFit,
                start,
                end,
              };
            });
            window.transitionEvents.push({
              event: 'ready',
              parts,
              targetSize: [targetBounds?.width, targetBounds?.height],
              headerName: getComputedStyle(document.querySelector('main .music-page-header'))
                .viewTransitionName,
              headerGroupAnimation: getComputedStyle(
                root,
                '::view-transition-group(music-record-list-header)',
              ).animationName,
              headerLayer: Number(
                getComputedStyle(root, '::view-transition-group(music-record-list-header)').zIndex,
              ),
              headerAnimation: getComputedStyle(
                root,
                '::view-transition-new(music-record-list-header)',
              ).animationName,
              source: active
                ?.querySelector('[data-music-record-part="artwork"]')
                ?.getAttribute('src'),
              artworkId: active?.getAttribute('data-music-record-card'),
              backgroundFilter: blur ? getComputedStyle(blur).filter : null,
              scroll: scrollY,
              previewInert: Boolean(document.querySelector('.record-list[inert]')),
              formReady: Boolean(document.querySelector('.music-detail-page input')),
            });
          },
          (error) => window.transitionEvents.push({ event: 'skipped', reason: error.message }),
        );
        transition.finished.then(
          () => window.transitionEvents.push({ event: 'finished' }),
          (error) => window.transitionEvents.push({ event: 'failed', reason: error.message }),
        );
        return transition;
      };
    },
    { token, noApi: config.noApi },
  );
  await page.route('**/authProtocolMode.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: [
        'isDirectAuthEnabled',
        'isDirectRefreshVerified',
        'isDirectSourceRecoveryVerified',
        'isDirectRebootstrapVerified',
      ]
        .map((n) => 'export const ' + n + '=()=>false;')
        .join('\n'),
    }),
  );
  await page.route('**/transition-fixture-*.svg', (route) => {
    const color = route
      .request()
      .url()
      .match(/fixture-([a-z]+)/)[1];
    return route.fulfill({
      contentType: 'image/svg+xml',
      body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="' +
        color +
        '"/><circle cx="100" cy="100" r="60" fill="white"/></svg>',
    });
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (isReturning && path.endsWith('/users/me/music-records')) {
      await new Promise((r) => setTimeout(r, 650));
    }
    const id = Number(path.match(/\/music-records\/(\d+)$/)?.[1]);
    if (id) {
      if (config.delay) await new Promise((r) => setTimeout(r, config.delay));
      if (config.failure)
        return route.fulfill({ status: 500, json: { message: 'fixture detail unavailable' } });
    }
    const list =
      config.paginated || config.filteredRestore
        ? url.searchParams.get('cursor') === 'after-target'
          ? { items: [records[0]], next_cursor: null, has_next: false }
          : url.searchParams.has('cursor')
            ? {
                items: config.moreAfterReturn
                  ? [
                      records[1],
                      records[2],
                      ...Array.from({ length: 10 }, (_, i) =>
                        album(30 + i, 'Second page fixture ' + i, 'purple'),
                      ),
                    ]
                  : [records[1], records[2]],
                next_cursor: config.moreAfterReturn ? 'after-target' : null,
                has_next: Boolean(config.moreAfterReturn),
              }
            : {
                items: Array.from({ length: 10 }, (_, i) =>
                  album(10 + i, 'Paged fixture ' + i, 'orange'),
                ),
                next_cursor: 'next',
                has_next: true,
              }
        : {
            items: config.directEntry
              ? records.filter((record) => record.record_id !== 2)
              : records,
            next_cursor: null,
            has_next: false,
          };
    const data = path.endsWith('/users/me/music-records')
      ? list
      : id
        ? records.find((record) => record.record_id === id)
        : path.endsWith('/auth/token/csrf')
          ? { csrf_token: 'fixture' }
          : path.endsWith('/auth/token/refresh')
            ? { access_token: token }
            : {};
    return route.fulfill({ json: { data } });
  });
  const path = config.directEntry ? '/music-records/2' : '/music-records';
  await page.goto(origin + path + (config.paginated ? '' : '?sido=11'));
  if (!config.directEntry) {
    if (config.paginated) {
      await page.getByRole('link', { name: 'Paged fixture 0 기록 상세 보기' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '더 불러오기' }).count(), 0);
      assert.equal(
        await page.getByRole('link', { name: records[1].music.title + ' 기록 상세 보기' }).count(),
        0,
      );
      await page.evaluate(() =>
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
      );
    }
    const link = page.getByRole('link', { name: records[1].music.title + ' 기록 상세 보기' });
    await link.locator('.record-cover').evaluate((img) => img.decode());
  }
  if (config.classicScrollbar)
    await page.addStyleTag({
      content: 'html,body{scrollbar-color:auto} html::-webkit-scrollbar {width: 15px}',
    });
  return {
    page,
    errors,
    startReturn: () => {
      isReturning = true;
    },
  };
}
function checkSharedParts(events, record, scenario) {
  const ready = events.find((event) => event.event === 'ready');
  assert.ok(ready, scenario + ' did not start the native transition');
  assert.equal(ready.artworkId, String(record.record_id));
  assert.equal(ready.source, record.music.album_cover_url);
  if (record.music.album_cover_url) assert.match(ready.backgroundFilter, /blur\(/);
  else assert.equal(ready.backgroundFilter, null);
  for (const part of ready.parts) {
    assert.ok(
      part.animation && part.animation !== 'none',
      scenario + ': ' + part.part + ' has no geometry animation',
    );
    assert.equal(part.oldAnimation, 'none');
    assert.equal(part.newAnimation, 'none');
    assert.equal(part.oldOpacity, '0', scenario + ': duplicate ' + part.part + ' is visible');
    assert.equal(part.newOpacity, '1', scenario + ': ' + part.part + ' is hidden');
    assert.ok(part.start && part.end);
    assert.notDeepEqual(part.start, part.end, scenario + ': ' + part.part + ' does not move');
    assert.equal(part.duration, '0.34s');
    if (part.part === 'title' || part.part === 'artist') assert.equal(part.newObjectFit, 'contain');
  }
  const background = ready.parts[0];
  const { sourceSize } = events.find((event) => event.event === 'started');
  for (let axis = 0; axis < 2; axis++) {
    assert.ok(Math.abs(background.start.size[axis] - sourceSize[axis]) < 1);
    assert.ok(Math.abs(background.end.size[axis] - ready.targetSize[axis]) < 1);
  }
  assert.ok(ready.parts.slice(1).every((part) => part.zIndex > background.zIndex));
  return ready;
}
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-features=OverlayScrollbar'],
    channel: 'chrome',
  });
  try {
    const scenarios = [
      { suite: 'normal', name: 'mobile slow detail', delay: 1000, expectAnimation: true },
      {
        suite: 'normal',
        name: 'desktop classic scrollbar',
        width: 1440,
        classicScrollbar: true,
        expectAnimation: true,
      },
      { suite: 'edge', name: 'coverless', recordId: 3, delay: 750, expectAnimation: true },
      { suite: 'edge', name: 'reduced motion', reducedMotion: 'reduce' },
      { suite: 'edge', name: 'unsupported API', noApi: true },
      { suite: 'edge', name: 'detail error', delay: 650, failure: true, expectAnimation: true },
      { suite: 'regression', name: 'edited record confirm', edited: true, expectAnimation: true },
      {
        suite: 'regression',
        name: 'paginated list restore at bottom',
        paginated: true,
        atBottom: true,
        expectAnimation: true,
      },
      {
        suite: 'regression',
        name: 'pagination continues after list return',
        paginated: true,
        moreAfterReturn: true,
        expectAnimation: true,
      },
      {
        suite: 'regression',
        name: 'filtered list restore',
        filteredRestore: true,
        expectAnimation: true,
      },
      {
        suite: 'regression',
        name: 'offscreen detail return',
        paginated: true,
        height: 430,
        offscreenDetail: true,
        expectAnimation: true,
      },
    ];
    for (const config of scenarios.filter((scenario) => !suite || scenario.suite === suite)) {
      const { page, errors, startReturn } = await setup(browser, config);
      const id = config.recordId ?? 2;
      const record = records.find((record) => record.record_id === id);
      const title = record.music.title;
      const search = config.paginated ? '' : '?sido=11';
      const link = page.getByRole('link', { name: title + ' 기록 상세 보기' });
      await link.scrollIntoViewIfNeeded();
      if (config.atBottom) {
        await page.getByRole('button', { name: '서울', exact: true }).waitFor();
        const bottomScroll = await page.evaluate(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          return scrollY;
        });
        await link.click({ trial: true });
        assert.equal(await page.evaluate(() => scrollY), bottomScroll);
      }
      const scrollBefore = await page.evaluate(() => scrollY);
      await link.click();
      await page.waitForURL(
        (url) => url.pathname === '/music-records/' + id && url.search === search,
      );
      if (config.expectAnimation)
        await page.waitForFunction(() =>
          window.transitionEvents.some((e) => e.event === 'finished' || e.event === 'failed'),
        );
      const events = await page.evaluate(() => window.transitionEvents);
      console.log(JSON.stringify({ scenario: config.name, events }));
      if (config.expectAnimation) {
        const ready = checkSharedParts(events, record, config.name);
        if (config.delay)
          assert.equal(ready.formReady, false, 'transition starts before delayed detail');
      } else {
        assert.deepEqual(events, []);
      }
      if (config.failure) {
        await page.getByRole('alert').filter({ hasText: 'fixture detail unavailable' }).waitFor();
        assert.equal(
          await page.locator('.music-detail-page [data-music-record-part="artwork"]').count(),
          0,
        );
      } else {
        await page.getByRole('region', { name: '음악 기록 상세 및 수정' }).waitFor();
        assert.equal(
          await page
            .locator('.music-detail-page [data-music-record-part="artwork"]')
            .getAttribute('src'),
          records.find((record) => record.record_id === id).music.album_cover_url,
        );
      }
      assert.equal(await page.locator('html').getAttribute('data-music-record-transition'), null);
      await page.evaluate(() => {
        window.transitionEvents = [];
      });
      const back = page.getByRole('button', { name: backName });
      let detailScroll;
      if (config.offscreenDetail) {
        detailScroll = await page
          .locator('.music-detail-page [data-music-record-card]')
          .evaluate((card) => {
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
            const bounds = card.getBoundingClientRect();
            const header = document.querySelector('.music-detail-page .music-page-header');
            return {
              top: scrollY,
              cardBottom: bounds.bottom,
              headerBottom: header.getBoundingClientRect().bottom,
            };
          });
        assert.ok(detailScroll.top > 0);
        assert.ok(detailScroll.cardBottom <= detailScroll.headerBottom);
        await back.click({ trial: true });
        assert.equal(await page.evaluate(() => scrollY), detailScroll.top);
      }
      if (config.edited) {
        await page.getByPlaceholder('예: 집 앞 작은 공원 (선택)').fill('Unsaved fixture edit');
        await back.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.getByRole('button', { name: '취소' }).click();
        await page.waitForFunction(
          (name) => document.activeElement?.getAttribute('aria-label') === name,
          backName,
        );
        assert.deepEqual(await page.evaluate(() => window.transitionEvents), []);
        await back.click();
        startReturn();
        await dialog.getByRole('button', { name: '확인' }).click();
      } else {
        startReturn();
        await back.click();
      }
      await page.waitForURL((url) => url.pathname === '/music-records' && url.search === search);
      if (config.expectAnimation && !config.failure)
        await page.waitForFunction(() =>
          window.transitionEvents.some((e) => e.event === 'finished'),
        );
      const reverse = await page.evaluate(() => window.transitionEvents);
      console.log(
        JSON.stringify({ scenario: config.name, direction: 'back', events: reverse, scrollBefore }),
      );
      if (config.expectAnimation && !config.failure) {
        if (config.offscreenDetail) {
          assert.deepEqual(
            reverse.map((event) => event.event),
            ['started', 'skipped', 'finished'],
          );
          assert.equal(reverse[0].scroll, detailScroll.top);
        } else {
          const ready = checkSharedParts(reverse, record, config.name + ' back');
          assert.ok(ready.parts.every((part) => part.zIndex < ready.headerLayer));
          assert.equal(ready.headerName, 'music-record-list-header');
          assert.equal(ready.headerGroupAnimation, 'none');
          assert.equal(ready.headerAnimation, 'none');
          assert.ok(ready.previewInert, 'reverse animates before delayed fresh list data');
          assert.equal(ready.scroll, scrollBefore);
        }
        if (config.paginated || config.filteredRestore)
          assert.ok(scrollBefore > 0, 'source card was below first viewport');
        await page.locator('.record-list[inert]').waitFor({ state: 'detached' });
        await page.getByRole('link', { name: title + ' 기록 상세 보기' }).waitFor();
        if (config.atBottom || config.moreAfterReturn) {
          await page.waitForFunction(() =>
            Array.from(document.querySelectorAll('.music-record-region-filter button')).some(
              (button) => button.textContent === '서울' && !button.disabled,
            ),
          );
        }
        assert.equal(await page.evaluate(() => scrollY), scrollBefore);
        if (config.moreAfterReturn) {
          const nextRecord = page.getByRole('link', {
            name: records[0].music.title + ' 기록 상세 보기',
          });
          assert.equal(await nextRecord.count(), 0);
          await page.evaluate(() =>
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
          );
          await nextRecord.waitFor();
          assert.equal(await page.locator('.record-list[inert]').count(), 0);
        }
      } else {
        assert.deepEqual(reverse, []);
      }
      assert.equal(await page.locator('html').getAttribute('data-music-record-transition'), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    if (!suite || suite === 'regression') {
      const { page, errors, startReturn } = await setup(browser, { directEntry: true });
      await page.getByRole('region', { name: '음악 기록 상세 및 수정' }).waitFor();
      startReturn();
      await page.getByRole('button', { name: backName }).click();
      await page.waitForURL(origin + '/music-records?sido=11');
      await page.waitForFunction(() =>
        window.transitionEvents.some((event) => event.event === 'finished'),
      );
      const events = await page.evaluate(() => window.transitionEvents);
      console.log(JSON.stringify({ scenario: 'direct entry with missing list card', events }));
      assert.deepEqual(
        events.map((event) => event.event),
        ['started', 'skipped', 'finished'],
      );
      await page.getByRole('link', { name: records[0].music.title + ' 기록 상세 보기' }).waitFor();
      assert.equal(
        await page.locator('.music-record-list-page [data-music-record-card="2"]').count(),
        0,
      );
      assert.equal(await page.locator('html').getAttribute('data-music-record-transition'), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
