/* global globalThis: readonly */
// Runs real window/renderer code with a temporary profile and fake voice events.
// Build dist first. No microphone, credentials, updates, or real user history.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const { build } = require(root + '/node_modules/esbuild');
const temp = fs.mkdtempSync(
  path.join(require('os').tmpdir(), 'cyrvis-companion-'),
);
fs.mkdirSync(path.join(temp, 'main'));
for (const name of ['renderer', 'preload']) {
  fs.symlinkSync(root + '/apps/ui-tars/dist/' + name, temp + '/' + name);
}
const source = `
import { app, ipcMain, BrowserWindow } from 'electron';
import { companionSkins, resolveCompanionSkin } from '${root}/apps/ui-tars/src/shared/companion-skins.ts';
import { getCompanionStore } from '${root}/apps/ui-tars/src/main/store/companion.ts';
import { createMainWindow, showWindow, showCompanion, sendCompanionCommand } from '${root}/apps/ui-tars/src/main/window/index.ts';
app.setPath('userData', '${temp}/profile');
(globalThis as any).clearCount = 0;
(globalThis as any).sendCompanionCommand = sendCompanionCommand;
(globalThis as any).companionSkins = companionSkins;
app.whenReady().then(() => {
 const store = getCompanionStore();
 (globalThis as any).selectedVoice = resolveCompanionSkin(store.get('skinId')).voice;
 store.onDidChange('skinId', id => { (globalThis as any).selectedVoice = resolveCompanionSkin(id).voice; });
 let state = { status: 'init', messages: [], theme: 'light', thinking: false, instructions: '', ensurePermissions: {accessibility:true, screenCapture:true} };
 let settings = { vlmApiKey:'test', vlmBaseUrl:'https://example.invalid', vlmModelName:'test', vlmProvider:'test' };
 const publish = () => BrowserWindow.getAllWindows().forEach(w => w.webContents.send('subscribe', state));
 ipcMain.handle('getState', () => state);
 ipcMain.handle('setting:get', () => settings);
 ipcMain.handle('setting:update', (_, next) => { settings = {...settings, ...next}; BrowserWindow.getAllWindows().forEach(w => w.webContents.send('setting-updated', settings)); });
 ipcMain.handle('getEnsurePermissions', () => state.ensurePermissions);
 ipcMain.handle('setInstructions', (_, data) => { state.instructions = data.instructions; publish(); });
 ipcMain.handle('setMessages', (_, data) => { state.messages = data.messages; publish(); });
 ipcMain.handle('setSessionHistoryMessages', (_, data) => { (globalThis as any).lastChatContext = data.messages; });
 ipcMain.handle('runAgent', async () => {
   state.status='running'; state.thinking=true; publish();
   if ((globalThis as any).holdNextRun) {
     (globalThis as any).holdNextRun=false;
     await new Promise(resolve => { (globalThis as any).finishPendingRun=resolve; });
   }
   state.messages=[...state.messages, {from:'gpt', value:'Your task is complete.', timing:{start:Date.now()}}];
   state.status='end'; state.thinking=false; publish();
 });
 ipcMain.handle('showMainWindow', () => showWindow());
 ipcMain.handle('clearHistory', () => { (globalThis as any).clearCount++; state.messages=[]; state.status='init'; publish(); });
 ipcMain.handle('cyrvis:voice:get-ptt', () => ({ mode: false, active: false }));
 ipcMain.handle('cyrvis:voice:get-mode', () => ({ mode: 'headset' }));
 ipcMain.handle('cyrvis:voice:start', () => ({ ok: false, error: 'Test mode' }));
 ipcMain.handle('cyrvis:voice:stop', () => { (globalThis as any).voicePaused=true; });
 ipcMain.on('cyrvis:voice:barge-in', () => { (globalThis as any).interrupted=true; BrowserWindow.getAllWindows().forEach(w=>w.webContents.send('cyrvis:voice:response-stopped')); });
 ipcMain.on('cyrvis:voice:playback-idle', () => { (globalThis as any).playbackIdleCount = ((globalThis as any).playbackIdleCount || 0) + 1; });
 ipcMain.handle('cyrvis:voice:set-mode', (_, mode) => { BrowserWindow.getAllWindows().forEach(w=>w.webContents.send('cyrvis:voice:audio-mode', {mode})); return {mode}; });
 createMainWindow(); showCompanion();
});
`;
const mocks = {
  '@main/env': `export const isDev=false, isMacOS=true, isWindows=false, rendererUrl=undefined;`,
  '@main/logger': `export const logger={ info(){}, error(){}, warn(){} };`,
  '@main/utils/updateApp': `export class AppUpdater { constructor(){} }`,
  '@main/menu': `export default class MenuBuilder { constructor(){} buildMenu(){} }`,
  '@main/services/windowManager': `export const windowManager = { registerWindow(){} };`,
};
async function check() {
  await build({
    stdin: { contents: source, resolveDir: root, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    outfile: temp + '/main/harness.cjs',
    tsconfig: root + '/apps/ui-tars/tsconfig.node.json',
    plugins: [
      {
        name: 'isolated-harness',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^@main\/(env|logger|utils\/updateApp|menu|services\/windowManager)$/,
            },
            (args) => ({ path: args.path, namespace: 'mock' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
            contents: mocks[args.path],
          }));
          b.onResolve({ filter: /icon\.png\?asset$/ }, () => ({
            path: 'icon',
            namespace: 'icon',
          }));
          b.onLoad({ filter: /.*/, namespace: 'icon' }, () => ({
            contents: `export default '${root}/apps/ui-tars/resources/icon.png'`,
          }));
        },
      },
    ],
  });

  const { _electron: electron, expect } = require(
    root + '/node_modules/playwright/test',
  );
  const app = await electron.launch({
    executablePath: require(root + '/node_modules/electron'),
    args: [path.join(temp, 'main/harness.cjs')],
    env: { ...process.env, CYRVIS_VOICE_TEST: '1' },
    cwd: temp,
    timeout: 20000,
  });
  const errors = [];
  app.on('window', (page) =>
    page.on('pageerror', (e) => errors.push(e.message)),
  );
  try {
    await expect.poll(() => app.windows().length).toBe(2);
    const pet = app.windows().find((p) => p.url().includes('/companion'));
    const main = app.windows().find((p) => !p.url().includes('/companion'));
    await expect(pet.locator('button.companion-button')).toBeVisible();
    const visibility = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          title: w.getTitle(),
          visible: w.isVisible(),
          url: w.webContents.getURL(),
        })),
      );
    let wins = await visibility();
    if (
      wins.filter((w) => w.visible).length !== 1 ||
      !wins.find((w) => w.visible).url.includes('/companion')
    )
      throw new Error('Main was visible on startup');
    await pet.screenshot({
      path: path.join(temp, 'companion.png'),
      omitBackground: true,
    });
    // Exercise the actual context-menu event and its native menu callbacks.
    // Capture popup to avoid an OS menu blocking the isolated test runner.
    await app.evaluate(({ Menu }) => {
      globalThis.originalPopup = Menu.prototype.popup;
      Menu.prototype.popup = function () {
        globalThis.petMenu = this;
      };
    });
    const selectSkin = async (id) => {
      await pet.locator('.companion-button').click({ button: 'right' });
      await app.evaluate((_, id) => {
        const skin = globalThis.companionSkins.find((s) => s.id === id);
        const groups = globalThis.petMenu.items.find(
          (i) => i.label === 'Appearance',
        ).submenu;
        const menu = groups.items.find((i) => i.label === skin.group).submenu;
        const item = menu.items.find((i) => i.label === skin.name);
        item.click(item, null, {});
      }, id);
      await expect(pet.locator('.companion-artwork')).toHaveAttribute(
        'data-skin',
        id,
      );
    };
    const skins = await app.evaluate(() => globalThis.companionSkins);
    for (const skin of skins) {
      await selectSkin(skin.id);
      expect(await app.evaluate(() => globalThis.selectedVoice)).toBe(
        skin.voice,
      );
      for (const state of [
        'idle',
        'listening',
        'thinking',
        'speaking',
        'working',
        'sleeping',
      ]) {
        await main.evaluate(
          (state) =>
            window.electron.companion.publish({
              state,
              micReady: true,
              error: null,
              skinId: 'cyrvis',
            }),
          state,
        );
        await expect(pet.locator('.companion-artwork')).toHaveAttribute(
          'data-skin',
          skin.id,
        );
        await expect(pet.locator('.companion-button')).toHaveAttribute(
          'aria-label',
          new RegExp(`^${state[0].toUpperCase() + state.slice(1)}\\.`),
        );
        await pet.locator('.companion-artwork').evaluate(async (el) => {
          const image = new Image();
          image.src =
            el.tagName === 'IMG'
              ? el.src
              : getComputedStyle(el).backgroundImage.slice(5, -2);
          await image.decode();
          if (!image.naturalWidth) throw new Error('Undecodable skin image');
          if (
            el.classList.contains('companion-sprite') &&
            (image.naturalWidth !== 1536 ||
              ![1872, 2288].includes(image.naturalHeight))
          )
            throw new Error('Unexpected atlas geometry');
        });
        if (state === 'idle') {
          if (skin.format === 'codex') {
            const start = await pet
              .locator('.companion-sprite')
              .evaluate((el) => getComputedStyle(el).backgroundPositionX);
            await expect
              .poll(() =>
                pet
                  .locator('.companion-sprite')
                  .evaluate((el) => getComputedStyle(el).backgroundPositionX),
              )
              .not.toBe(start);
          }
          await pet.screenshot({
            path: path.join(temp, `skin-${skin.id}.png`),
            omitBackground: true,
          });
        }
      }
      await pet.locator('.companion-button').click({ button: 'right' });
      expect(
        await app.evaluate(() =>
          globalThis.petMenu.items
            .find((i) => i.label === 'Appearance')
            .submenu.items.flatMap((g) => g.submenu.items)
            .filter((i) => i.checked)
            .map((i) => i.label),
        ),
      ).toEqual([skin.name]);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(temp, 'profile/cyrvis-companion.json'),
            'utf8',
          ),
        ).skinId,
      ).toBe(skin.id);
    }
    await selectSkin('cyrvis');
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = globalThis.originalPopup;
    });
    console.log(
      'Verified: five right-click skins, six states each, local image decoding, animated atlases, checked menu items, stored selection, voice cannot overwrite appearance',
    );
    await expect
      .poll(() =>
        main.evaluate(
          () => window.electron.voice.debugAudioSubscribers().total,
        ),
      )
      .toBe(1);
    const voiceState = {
      awake: true,
      userSpeaking: false,
      ttsSpeaking: false,
      lastUserText: '',
      task: {
        taskId: null,
        status: 'idle',
        instruction: null,
        step: 0,
        lastSummary: null,
        error: null,
      },
    };
    const emit = async (channel, data) =>
      app.evaluate(
        ({ BrowserWindow }, p) => {
          for (const w of BrowserWindow.getAllWindows())
            w.webContents.send(p.channel, p.data);
        },
        { channel, data },
      );
    await emit('cyrvis:voice:capture-ready', { label: 'Test microphone' });
    await emit('cyrvis:voice:state', voiceState);
    await expect(pet.locator('img')).toHaveAttribute('alt', 'CYRVIS Idle');
    await expect(
      pet.getByRole('region', { name: 'Live conversation' }),
    ).toHaveCount(0);
    await emit('cyrvis:voice:state', { ...voiceState, userSpeaking: true });
    await expect(pet.locator('img')).toHaveAttribute('alt', 'CYRVIS Listening');
    await emit('cyrvis:voice:state', voiceState);
    await emit('cyrvis:voice:thinking');
    await expect(pet.locator('img')).toHaveAttribute('alt', 'CYRVIS Thinking');
    await emit('cyrvis:voice:state', { ...voiceState, ttsSpeaking: true });
    await expect(pet.locator('img')).toHaveAttribute('alt', 'CYRVIS Speaking');
    await emit('cyrvis:voice:state', {
      ...voiceState,
      task: { ...voiceState.task, status: 'executing' },
    });
    await expect(pet.locator('img')).toHaveAttribute('alt', 'CYRVIS Working');
    await emit('cyrvis:voice:response-stopped');
    await emit('cyrvis:voice:state', { ...voiceState, awake: false });
    await expect(pet.locator('img')).toHaveAttribute('alt', 'CYRVIS Sleeping');
    const beforeDrag = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('/companion'))
        .getPosition(),
    );
    await pet.locator('button.companion-button').hover();
    await pet.mouse.down();
    await app.evaluate(({ screen }) => {
      globalThis.originalCursor = screen.getCursorScreenPoint;
      const p = screen.getCursorScreenPoint();
      screen.getCursorScreenPoint = () => ({ x: p.x - 80, y: p.y - 60 });
    });
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((w) => w.webContents.getURL().includes('/companion'))
              .getPosition()[0],
        ),
      )
      .toBe(beforeDrag[0] - 80);
    await pet.mouse.up();
    await app.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = globalThis.originalCursor;
    });
    wins = await visibility();
    if (wins.find((w) => !w.url.includes('/companion')).visible)
      throw new Error('Drag incorrectly opened history');
    await pet.locator('button.companion-button').focus();
    await pet.keyboard.press('Enter');
    await expect(
      main.getByRole('heading', { name: 'Welcome to Cyrvis' }),
    ).toBeVisible();
    wins = await visibility();
    if (!wins.find((w) => !w.url.includes('/companion')).visible)
      throw new Error('Click did not show main');
    await main.screenshot({ path: path.join(temp, 'home.png') });
    const subs = await Promise.all(
      [main, pet].map((p) =>
        p.evaluate(() => window.electron.voice.debugAudioSubscribers()),
      ),
    );
    if (subs[0].total !== 1 || subs[1].total !== 0)
      throw new Error('Duplicate audio owners ' + JSON.stringify(subs));
    await emit('cyrvis:voice:transcript', {
      text: 'Summarize today’s meeting',
      final: true,
    });
    await emit('cyrvis:voice:assistant', {
      text: 'The discussion points and action items are ready.',
      final: true,
    });
    const record = main.getByRole('link', {
      name: 'Summarize today’s meeting',
      exact: true,
    });
    await expect(record).toBeVisible();
    await record.click();
    await expect(
      main.getByText('The discussion points and action items are ready.', {
        exact: true,
      }),
    ).toBeVisible();
    if ((await app.evaluate(() => globalThis.clearCount)) !== 0)
      throw new Error('History browsing cleared live task');
    // Seed two screenshot records in this temporary profile and exercise linkage.
    const recordId = (await record.getAttribute('href')).split('/').pop();
    await main.evaluate(async (id) => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 560;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f4f4f2';
      ctx.fillRect(0, 0, 900, 560);
      ctx.fillStyle = '#242424';
      ctx.font = '32px sans-serif';
      ctx.fillText('Meeting notes', 50, 70);
      ctx.font = '22px sans-serif';
      ctx.fillText('Discussion points and action items', 50, 130);
      const first = canvas.toDataURL().split(',')[1];
      ctx.fillStyle = '#35684c';
      ctx.fillText('All notes saved', 50, 190);
      const second = canvas.toDataURL().split(',')[1];
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('ui_tars_db_chat');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('chats', 'readwrite');
          const store = tx.objectStore('chats');
          const read = store.get(id);
          read.onsuccess = () =>
            store.put(
              [
                ...read.result,
                { from: 'human', value: '<image>', screenshotBase64: first },
                { from: 'human', value: '<image>', screenshotBase64: second },
              ],
              id,
            );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
      const channel = new BroadcastChannel('cyrvis-history');
      channel.postMessage({ type: 'changed' });
      channel.close();
    }, recordId);
    const shots = main.getByRole('button', { name: 'Screenshot', exact: true });
    await expect(shots).toHaveCount(2);
    await shots.first().click();
    await expect(
      main.getByRole('img', { name: 'screenshot from message 3' }),
    ).toBeVisible();
    await main
      .getByRole('button', { name: 'Next screenshot', exact: true })
      .click();
    await expect(
      main.getByRole('img', { name: 'screenshot from message 4' }),
    ).toBeVisible();
    const left = await main
      .getByRole('region', { name: 'Conversation', exact: true })
      .boundingBox();
    const right = await main
      .getByRole('region', { name: 'Screenshots', exact: true })
      .boundingBox();
    if (left.x + left.width > right.x)
      throw new Error('Conversation and screenshots are not side by side');
    await main.screenshot({ path: path.join(temp, 'history.png') });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes('/companion'))
        .setSize(640, 480),
    );
    await main.screenshot({ path: path.join(temp, 'compact.png') });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes('/companion'))
        .setSize(1200, 800),
    );
    await main
      .getByRole('button', { name: 'New chat', exact: true })
      .last()
      .click();
    await expect(
      main.getByPlaceholder('What can I do for you today?'),
    ).toBeVisible();
    const historyLinks = main
      .getByRole('navigation', { name: 'History' })
      .getByRole('link');
    await expect(historyLinks).toHaveCount(1);
    for (let i = 0; i < 3; i++) {
      await main
        .getByRole('button', { name: 'New chat', exact: true })
        .last()
        .click();
      await expect(
        main.getByRole('textbox', { name: 'Message', exact: true }),
      ).toBeVisible();
      await expect(historyLinks).toHaveCount(1);
    }
    await main
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('   ');
    await expect(
      main.getByRole('button', { name: 'Send message', exact: true }),
    ).toBeDisabled();
    await main
      .getByRole('textbox', { name: 'Message', exact: true })
      .press('Enter');
    await expect(historyLinks).toHaveCount(1);
    await main
      .getByPlaceholder('What can I do for you today?')
      .fill('Organize my workspace');
    await main
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(
      main.getByText('Your task is complete.', { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'Organize my workspace', exact: true }),
    ).toBeVisible();
    await expect(historyLinks).toHaveCount(2);
    await main.screenshot({ path: path.join(temp, 'new-chat.png') });
    await main
      .getByRole('button', { name: 'New chat', exact: true })
      .last()
      .click();
    await expect(
      main.getByRole('textbox', { name: 'Message', exact: true }),
    ).toHaveValue('');
    await expect(
      main.getByText('Your task is complete.', { exact: true }),
    ).toHaveCount(0);
    await expect(historyLinks).toHaveCount(2);
    // Continue a saved voice conversation, then leave while the reply is pending.
    await record.click();
    await expect(
      main.getByRole('textbox', { name: 'Message', exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      globalThis.holdNextRun = true;
    });
    await main
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Add deadlines to those action items');
    await main
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(
      main.getByRole('button', { name: 'Stop task', exact: true }),
    ).toBeVisible();
    await main
      .getByRole('link', { name: 'Organize my workspace', exact: true })
      .click();
    await expect(
      main.getByRole('textbox', { name: 'Message', exact: true }),
    ).toBeDisabled();
    await expect(
      main.getByRole('button', { name: 'Stop task', exact: true }),
    ).toHaveCount(0);
    const context = await app.evaluate(() => globalThis.lastChatContext);
    if (
      !context.some(
        (m) => m.value === 'The discussion points and action items are ready.',
      ) ||
      context.some((m) => m.value === 'Organize my workspace')
    )
      throw new Error(
        'Continuation lost assistant context or included another chat',
      );
    await app.evaluate(() => globalThis.finishPendingRun());
    await expect(
      main.getByRole('textbox', { name: 'Message', exact: true }),
    ).toBeEnabled();
    await record.click();
    await expect(
      main.getByText('Add deadlines to those action items', { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText('Your task is complete.', { exact: true }),
    ).toHaveCount(1);
    await expect(
      main.getByRole('button', { name: 'Screenshot', exact: true }),
    ).toHaveCount(2);
    await main
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Also assign an owner to each item');
    await main
      .getByRole('textbox', { name: 'Message', exact: true })
      .press('Enter');
    await expect(
      main.getByText('Your task is complete.', { exact: true }),
    ).toHaveCount(2);
    await expect(record).toBeVisible();
    await main.screenshot({ path: path.join(temp, 'history-continue.png') });
    const savedRows = await main.evaluate(
      async (id) =>
        new Promise((resolve) => {
          const req = indexedDB.open('ui_tars_db_chat');
          req.onsuccess = () => {
            const db = req.result;
            const read = db.transaction('chats').objectStore('chats').get(id);
            read.onsuccess = () => {
              resolve(read.result);
              db.close();
            };
          };
        }),
      recordId,
    );
    if (
      savedRows.length !== 8 ||
      savedRows.filter((m) => m.value === 'Add deadlines to those action items')
        .length !== 1
    )
      throw new Error('Continuation overwrote or duplicated saved messages');
    const clearBeforeDelete = await app.evaluate(() => globalThis.clearCount);
    await main
      .getByRole('button', {
        name: 'More options for Summarize today’s meeting',
        exact: true,
      })
      .click();
    await main.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await main.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(record).toBeVisible();
    await record.click();
    await main
      .getByRole('button', {
        name: 'More options for Summarize today’s meeting',
        exact: true,
      })
      .click();
    await main.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await main.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(record).toHaveCount(0);
    await expect(
      main.getByRole('heading', { name: 'Welcome to Cyrvis' }),
    ).toBeVisible();
    const stored = await main.evaluate(
      async (id) =>
        new Promise((resolve) => {
          const req = indexedDB.open('ui_tars_db_chat');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('chats');
            const read = tx.objectStore('chats').get(id);
            read.onsuccess = () => {
              resolve(read.result ?? null);
              db.close();
            };
          };
        }),
      recordId,
    );
    if (stored !== null)
      throw new Error('Deleted screenshots remain in database');
    if ((await app.evaluate(() => globalThis.clearCount)) !== clearBeforeDelete)
      throw new Error('Deleting history reset live task');
    await main
      .getByRole('link', { name: 'Organize my workspace', exact: true })
      .click();
    await expect(
      main.getByText('Your task is complete.', { exact: true }),
    ).toBeVisible();
    if (/[\u4e00-\u9fff]/.test(await main.locator('body').innerText()))
      throw new Error('Non-English UI copy remains');
    await app.evaluate(() => globalThis.sendCompanionCommand('settings'));
    await expect(main.getByRole('dialog')).toBeVisible();
    await main.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes('/companion'))
        .close(),
    );
    wins = await visibility();
    if (
      !wins.find((w) => w.url.includes('/companion')).visible ||
      wins.find((w) => !w.url.includes('/companion')).visible
    )
      throw new Error('Close did not restore companion');
    if (
      (await main.evaluate(
        () => window.electron.voice.debugAudioSubscribers().total,
      )) !== 1
    )
      throw new Error('Voice owner lost after close');
    // Exercise the actual hidden audio owner -> IPC -> companion text panel.
    await emit('cyrvis:voice:capture-ready', { label: 'Test microphone' });
    await emit('cyrvis:voice:state', voiceState);
    await emit('cyrvis:voice:speech-started');
    await emit('cyrvis:voice:transcript', {
      text: '你好，今天怎么样？',
      final: false,
    });
    await expect(
      pet.getByText('你好，今天怎么样？', { exact: true }),
    ).toBeVisible();
    await emit('cyrvis:voice:response-started');
    await emit('cyrvis:voice:assistant', { text: '你好！', final: false });
    // A late ASR final must not erase already-arriving assistant tokens.
    await emit('cyrvis:voice:transcript', {
      text: '你好，今天怎么样？',
      final: true,
    });
    await emit('cyrvis:voice:assistant', { text: '我在这里。', final: false });
    await expect(
      pet.getByText('你好！我在这里。', { exact: true }),
    ).toBeVisible();
    await emit('cyrvis:voice:assistant', {
      text: '你好！我在这里。',
      final: true,
    });
    await expect(
      pet.getByText('你好！我在这里。', { exact: true }),
    ).toHaveCount(1);
    await emit('cyrvis:voice:state', { ...voiceState, ttsSpeaking: true });
    await expect.poll(() => pet.evaluate(() => window.innerWidth)).toBe(360);
    await expect.poll(() => pet.evaluate(() => window.innerHeight)).toBe(520);
    await pet.screenshot({
      fullPage: true,
      path: path.join(temp, 'live-conversation.png'),
      omitBackground: true,
    });
    await pet.getByRole('button', { name: 'Interrupt', exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => globalThis.interrupted))
      .toBe(true);
    await emit('cyrvis:voice:state', voiceState);
    await emit('cyrvis:voice:response-started');
    await emit('cyrvis:voice:assistant', { text: '第二条回复', final: false });
    await expect(pet.getByText('第二条回复', { exact: true })).toBeVisible();
    await expect(
      pet.getByText('你好！我在这里。', { exact: true }),
    ).toHaveCount(0);
    const longReply =
      '这是一条较长的回复，可以滚动查看，也可以选择和复制文字。'.repeat(50);
    await emit('cyrvis:voice:assistant', { text: longReply, final: true });
    await expect
      .poll(() =>
        pet
          .locator('.companion-conversation-output')
          .evaluate(
            (el) => el.scrollHeight > el.clientHeight && el.scrollTop > 0,
          ),
      )
      .toBe(true);
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
      const b = BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('/companion'))
        .getBounds();
      const a = screen.getDisplayMatching(b).workArea;
      return (
        b.x >= a.x &&
        b.y >= a.y &&
        b.x + b.width <= a.x + a.width &&
        b.y + b.height <= a.y + a.height
      );
    });
    if (!bounds) throw new Error('Conversation is outside display');
    await emit('cyrvis:voice:response-done');
    await emit('cyrvis:voice:state', voiceState);
    await expect(
      pet.getByRole('region', { name: 'Live conversation' }),
    ).toHaveCount(0, { timeout: 8000 });
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((w) => w.webContents.getURL().includes('/companion'))
              .getSize()[0],
        ),
      )
      .toBe(220);
    await pet.mouse.move(0, 0);
    await pet.screenshot({
      path: path.join(temp, 'idle-companion.png'),
      omitBackground: true,
    });
    // A fresh turn reopens the bubble after the previous one has timed out.
    await emit('cyrvis:voice:speech-started');
    await emit('cyrvis:voice:state', { ...voiceState, userSpeaking: true });
    await expect(
      pet.getByRole('region', { name: 'Live conversation' }),
    ).toBeVisible();
    await expect(pet.getByRole('status', { name: 'Listening' })).toBeVisible();
    await pet.locator('.companion-robot').hover();

    await pet
      .getByRole('button', { name: 'Pause conversation', exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => globalThis.voicePaused))
      .toBe(true);
    await expect(
      pet.getByRole('button', { name: 'Start conversation', exact: true }),
    ).toBeVisible();
    await pet
      .getByRole('button', { name: 'Start conversation', exact: true })
      .click();
    await expect(pet.locator('.companion-button')).toHaveAttribute(
      'title',
      'Error: Test mode',
    );
    await expect(
      pet.getByRole('region', { name: 'Live conversation' }),
    ).toHaveCount(0);
    await emit('cyrvis:voice:capture-error', {
      message: 'Unexpected server response: 401',
    });
    await expect(pet.locator('.companion-button')).toHaveAttribute(
      'title',
      /Qwen API key/,
    );
    await expect(
      pet.getByRole('region', { name: 'Live conversation' }),
    ).toHaveCount(0);
    await pet.screenshot({
      path: path.join(temp, 'voice-unavailable.png'),
      omitBackground: true,
    });
    await emit('cyrvis:voice:state', voiceState);
    await emit('cyrvis:voice:capture-ready', { label: 'Test microphone' });
    await expect(
      pet.getByRole('region', { name: 'Live conversation' }),
    ).toHaveCount(0);
    console.log(
      'Verified: streaming conversation, late ASR final, replacement on new response, interrupt/pause/start controls, long text scrolling, bounds, auto-hide after silence, fresh-turn reopening, and idle/error compact mode',
    );
    // Real Chromium audio clock with silent PCM: generation finishes before
    // two seconds of output drain, so the mic must not reopen immediately.
    await emit('cyrvis:voice:response-stopped');
    const idleCount = await app.evaluate(
      () => globalThis.playbackIdleCount || 0,
    );
    await emit('cyrvis:voice:response-started');
    const playbackStart = Date.now();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(
        (w) => !w.webContents.getURL().includes('/companion'),
      );
      for (let i = 0; i < 8; i++)
        w.webContents.send('cyrvis:voice:audio', new Int16Array(6000).buffer);
      w.webContents.send('cyrvis:voice:response-done');
    });
    await expect
      .poll(() => app.evaluate(() => globalThis.playbackIdleCount || 0))
      .toBe(idleCount + 1);
    if (Date.now() - playbackStart < 1900)
      throw new Error('Audio tail was cut before playback drained');
    // Replacing an unfinished response must not let its stop callback release
    // the microphone during the next response.
    await emit('cyrvis:voice:response-started');
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(
        (w) => !w.webContents.getURL().includes('/companion'),
      );
      w.webContents.send('cyrvis:voice:audio', new Int16Array(48000).buffer);
      w.webContents.send('cyrvis:voice:response-started');
    });
    await expect(pet.locator('.companion-button')).toBeVisible();
    if (
      (await app.evaluate(() => globalThis.playbackIdleCount || 0)) !==
      idleCount + 1
    )
      throw new Error('Replaced player emitted a stale playback-idle event');
    await emit('cyrvis:voice:response-stopped');
    console.log(
      'Verified: real audio clock drains complete PCM response and replacement does not release the next response microphone',
    );
    if (errors.length)
      throw new Error('Renderer errors: ' + JSON.stringify(errors));
    console.log(
      'Verified: drag without accidental open, keyboard activation, pet-first startup, six poses, click/open/close, one audio owner, persisted conversation, non-destructive history browsing, continuation with context, persistence across navigation, compact layout, draft-only new chat, repeated clicks and blank input, first-send creation, screenshot selection, cancel/delete and data removal, English UI, settings; zero page errors',
    );
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function () {
        globalThis.petMenu = this;
      };
    });
    await selectSkin('jarvis');
  } finally {
    await app.close();
  }

  const restarted = await electron.launch({
    executablePath: require(root + '/node_modules/electron'),
    args: [path.join(temp, 'main/harness.cjs')],
    env: { ...process.env, CYRVIS_VOICE_TEST: '1' },
    cwd: temp,
  });
  try {
    await expect.poll(() => restarted.windows().length).toBe(2);
    const pet = restarted.windows().find((p) => p.url().includes('/companion'));
    await expect(pet.locator('.companion-artwork')).toHaveAttribute(
      'data-skin',
      'jarvis',
    );
    expect(await restarted.evaluate(() => globalThis.selectedVoice)).toBe(
      'Raymond',
    );
    console.log(
      'Verified: appearance and voice restored after a full Electron restart',
    );
  } finally {
    await restarted.close();
  }

  console.log('Screenshots and isolated profile:', temp);
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
