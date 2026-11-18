/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { app, BrowserWindow } from 'electron';

import { logger } from '@main/logger';

import { createWindow } from './createWindow';
import { hideCompanionWindow, showCompanionWindow } from './companionWindow';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

export function showInactive() {
  if (mainWindow) {
    // eslint-disable-next-line no-unused-expressions
    mainWindow.showInactive();
  }
}

export function show() {
  if (mainWindow) {
    mainWindow.show();
  }
}

export function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = createWindow({
    routerPath: '/',
    title: 'Cyrvis',
    minWidth: 640,
    minHeight: 480,
    width: 1200,
    height: 700,
    alwaysOnTop: false,
    showInBackground: true,
  });

  mainWindow.on('close', (event) => {
    logger.info('mainWindow closed');
    if (isQuitting) {
      mainWindow = null;
      return;
    }

    event.preventDefault();
    if (mainWindow?.isFullScreen()) {
      mainWindow?.setFullScreen(false);
      mainWindow?.once('leave-full-screen', () => {
        mainWindow?.hide();
      });
    } else {
      mainWindow?.hide();
    }
    showCompanionWindow();
  });

  return mainWindow;
}

export function setContentProtection(enable: boolean) {
  mainWindow?.setContentProtection(enable);
}

export async function showWindow() {
  await showMainWindow();
}

export function sendCompanionCommand(command: string) {
  if (command === 'settings') void showWindow();
  mainWindow?.webContents.send('cyrvis:companion:command', command);
}

export function showCompanion() {
  showCompanionWindow();
}

export async function hideMainWindow() {
  try {
    mainWindow?.setContentProtection(true);
    mainWindow?.setAlwaysOnTop(true);
    mainWindow?.setFocusable(false);
    mainWindow?.hide();
  } catch (error) {
    logger.error('[hideMainWindow]', error);
  }
}

export async function showMainWindow() {
  try {
    hideCompanionWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
    mainWindow?.setContentProtection(false);
    mainWindow?.setIgnoreMouseEvents(false);
    mainWindow?.setAlwaysOnTop(false);
    mainWindow?.setFocusable(true);
    mainWindow?.restore();
    mainWindow?.show();
    mainWindow?.focus();
  } catch (error) {
    logger.error('[showMainWindow]', error);
  }
}
